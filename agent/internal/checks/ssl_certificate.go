package checks

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/lukas5001/overseer-agent/internal/types"
	"golang.org/x/crypto/ocsp"
)

// checkSSLCertificate connects to a host:port via TLS, reads the certificate,
// and validates expiry, hostname, chain, self-signed, algorithm strength, key size, and OCSP.
func checkSSLCertificate(config map[string]any, _, _ *float64) types.CheckResult {
	host := getConfigString(config, "host", "")
	if host == "" {
		return types.CheckResult{Status: "UNKNOWN", Message: "no host configured"}
	}

	port := 443
	if p, ok := toFloat64(config["port"]); ok && p > 0 {
		port = int(p)
	}

	warningDays := 30
	if w, ok := toFloat64(config["warning_days"]); ok {
		warningDays = int(w)
	}

	criticalDays := 14
	if c, ok := toFloat64(config["critical_days"]); ok {
		criticalDays = int(c)
	}

	allowSelfSigned := false
	if v, ok := config["allow_self_signed"].(bool); ok {
		allowSelfSigned = v
	}

	checkOCSP := false
	if v, ok := config["check_ocsp"].(bool); ok {
		checkOCSP = v
	}

	timeout := 10 * time.Second
	if t, ok := toFloat64(config["timeout"]); ok && t > 0 {
		timeout = time.Duration(t) * time.Second
	}

	return doSSLCertificateCheck(host, port, warningDays, criticalDays, allowSelfSigned, checkOCSP, timeout)
}

// doSSLCertificateCheck performs the actual SSL certificate validation.
// Shared logic used by both agent and collector (collector calls this via its own wrapper).
func doSSLCertificateCheck(host string, port, warningDays, criticalDays int, allowSelfSigned, checkOCSPFlag bool, timeout time.Duration) types.CheckResult {
	addr := fmt.Sprintf("%s:%d", host, port)

	// Connect with InsecureSkipVerify to read the cert, then validate manually
	dialer := &net.Dialer{Timeout: timeout}
	conn, err := tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{
		InsecureSkipVerify: true,
		ServerName:         host,
	})
	if err != nil {
		return types.CheckResult{
			Status:  "CRITICAL",
			Message: fmt.Sprintf("TLS connection failed to %s: %s", addr, err),
		}
	}
	defer conn.Close()

	certs := conn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return types.CheckResult{
			Status:  "CRITICAL",
			Message: fmt.Sprintf("No certificates presented by %s", addr),
		}
	}

	leaf := certs[0]
	now := time.Now()

	// Calculate days until expiry
	daysUntilExpiry := int(time.Until(leaf.NotAfter).Hours() / 24)
	daysValue := float64(daysUntilExpiry)

	// Check self-signed
	isSelfSigned := leaf.Issuer.String() == leaf.Subject.String()

	// Hostname verification
	hostnameValid := leaf.VerifyHostname(host) == nil

	// Chain validation against system root CAs
	intermediates := x509.NewCertPool()
	for _, ic := range certs[1:] {
		intermediates.AddCert(ic)
	}
	_, chainErr := leaf.Verify(x509.VerifyOptions{
		DNSName:       host,
		Intermediates: intermediates,
		CurrentTime:   now,
	})
	chainValid := chainErr == nil

	// Signature algorithm strength
	sigAlgo := leaf.SignatureAlgorithm.String()
	weakAlgo := isWeakAlgorithm(leaf.SignatureAlgorithm)

	// Key type and size
	keyType, keySize := getKeyInfo(leaf)
	weakKey := keyType == "RSA" && keySize < 2048

	// OCSP check (optional)
	ocspStatus := ""
	if checkOCSPFlag {
		ocspStatus = checkOCSSP(leaf, certs, timeout)
	}

	// SANs
	sans := leaf.DNSNames

	// Serial number
	serialNumber := formatSerial(leaf.SerialNumber)

	// Issuer display name
	issuerName := leaf.Issuer.CommonName
	if issuerName == "" {
		issuerName = leaf.Issuer.Organization[0]
	}

	// Build metadata
	metadata := map[string]any{
		"subject":           leaf.Subject.CommonName,
		"issuer":            issuerName,
		"sans":              sans,
		"not_before":        leaf.NotBefore.UTC().Format(time.RFC3339),
		"not_after":         leaf.NotAfter.UTC().Format(time.RFC3339),
		"days_until_expiry": daysUntilExpiry,
		"is_self_signed":    isSelfSigned,
		"hostname_valid":    hostnameValid,
		"chain_valid":       chainValid,
		"signature_algorithm": sigAlgo,
		"key_type":          keyType,
		"key_size":          keySize,
		"serial_number":     serialNumber,
	}
	if ocspStatus != "" {
		metadata["ocsp_status"] = ocspStatus
	}

	// Determine status and message
	status, message := evaluateSSLStatus(
		host, daysUntilExpiry, warningDays, criticalDays,
		hostnameValid, chainValid, isSelfSigned, allowSelfSigned,
		weakAlgo, weakKey, ocspStatus,
		leaf, issuerName,
	)

	return types.CheckResult{
		Status:   status,
		Value:    &daysValue,
		Unit:     "days",
		Message:  message,
		Metadata: metadata,
	}
}

// evaluateSSLStatus determines the check status and message based on certificate properties.
func evaluateSSLStatus(
	host string, daysUntilExpiry, warningDays, criticalDays int,
	hostnameValid, chainValid, isSelfSigned, allowSelfSigned bool,
	weakAlgo, weakKey bool, ocspStatus string,
	leaf *x509.Certificate, issuerName string,
) (string, string) {
	expiryDate := leaf.NotAfter.Format("2006-01-02")

	// CRITICAL conditions (check most severe first)
	if daysUntilExpiry <= 0 {
		return "CRITICAL", fmt.Sprintf("Certificate EXPIRED %d days ago (%s)! Immediate renewal required.", -daysUntilExpiry, expiryDate)
	}
	if !hostnameValid {
		certNames := leaf.Subject.CommonName
		if len(leaf.DNSNames) > 0 {
			certNames = strings.Join(leaf.DNSNames, ", ")
		}
		return "CRITICAL", fmt.Sprintf("Certificate hostname mismatch: expected %s, got %s", host, certNames)
	}
	if !chainValid {
		return "CRITICAL", "Certificate chain validation failed: unable to verify certificate chain"
	}
	if ocspStatus == "revoked" {
		return "CRITICAL", fmt.Sprintf("Certificate has been REVOKED (expires %s)", expiryDate)
	}
	if daysUntilExpiry <= criticalDays {
		return "CRITICAL", fmt.Sprintf("Expires in %d days (%s)! Immediate renewal required.", daysUntilExpiry, expiryDate)
	}

	// WARNING conditions
	if daysUntilExpiry <= warningDays {
		return "WARNING", fmt.Sprintf("Expires in %d days (%s), issued by %s", daysUntilExpiry, expiryDate, issuerName)
	}
	if isSelfSigned && !allowSelfSigned {
		return "WARNING", fmt.Sprintf("Self-signed certificate (expires %s)", expiryDate)
	}
	if weakAlgo {
		return "WARNING", fmt.Sprintf("Weak signature algorithm: %s (expires %s)", leaf.SignatureAlgorithm.String(), expiryDate)
	}
	if weakKey {
		keyType, keySize := getKeyInfo(leaf)
		return "WARNING", fmt.Sprintf("Weak key: %s %d bit (expires %s)", keyType, keySize, expiryDate)
	}

	// OK
	return "OK", fmt.Sprintf("Valid for %d days (expires %s), issued by %s", daysUntilExpiry, expiryDate, issuerName)
}

// isWeakAlgorithm returns true for SHA-1 and MD5 based signature algorithms.
func isWeakAlgorithm(algo x509.SignatureAlgorithm) bool {
	switch algo {
	case x509.SHA1WithRSA, x509.ECDSAWithSHA1,
		x509.MD5WithRSA, x509.MD2WithRSA:
		return true
	}
	return false
}

// getKeyInfo extracts the key type and size from a certificate.
func getKeyInfo(cert *x509.Certificate) (string, int) {
	switch pub := cert.PublicKey.(type) {
	case *rsa.PublicKey:
		return "RSA", pub.N.BitLen()
	case *ecdsa.PublicKey:
		return "ECDSA", pub.Curve.Params().BitSize
	case ed25519.PublicKey:
		return "Ed25519", 256
	}
	return "Unknown", 0
}

// checkOCSP performs an OCSP revocation check.
func checkOCSSP(leaf *x509.Certificate, chain []*x509.Certificate, timeout time.Duration) string {
	if len(leaf.OCSPServer) == 0 {
		return "" // No OCSP server listed, skip
	}

	if len(chain) < 2 {
		return "unknown" // Need issuer cert for OCSP request
	}
	issuer := chain[1]

	ocspReq, err := ocsp.CreateRequest(leaf, issuer, nil)
	if err != nil {
		return "unknown"
	}

	httpClient := &http.Client{Timeout: timeout}
	resp, err := httpClient.Post(leaf.OCSPServer[0], "application/ocsp-request", strings.NewReader(string(ocspReq)))
	if err != nil {
		return "unknown"
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "unknown"
	}

	ocspResp, err := ocsp.ParseResponseForCert(respBytes, leaf, issuer)
	if err != nil {
		return "unknown"
	}

	switch ocspResp.Status {
	case ocsp.Good:
		return "good"
	case ocsp.Revoked:
		return "revoked"
	default:
		return "unknown"
	}
}

// formatSerial formats a certificate serial number as colon-separated hex.
func formatSerial(serial *big.Int) string {
	b := serial.Bytes()
	s := hex.EncodeToString(b)
	var parts []string
	for i := 0; i < len(s); i += 2 {
		end := i + 2
		if end > len(s) {
			end = len(s)
		}
		parts = append(parts, s[i:end])
	}
	return strings.Join(parts, ":")
}
