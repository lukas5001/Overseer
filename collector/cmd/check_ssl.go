package main

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

	"golang.org/x/crypto/ocsp"
)

// doSSLCertificateCheck connects to host:port via TLS, reads the certificate,
// and validates expiry, hostname, chain, self-signed, algorithm, key size, and OCSP.
func doSSLCertificateCheck(host HostConfig, check CheckConfig) CheckResult {
	targetHost := ""
	if h, ok := check.Config["host"].(string); ok && h != "" {
		targetHost = h
	}
	if targetHost == "" {
		targetHost = host.IPAddress
	}
	if targetHost == "" {
		targetHost = host.Hostname
	}
	if targetHost == "" {
		return unknownResult(host.Hostname, check.Name, check.Type, "no host configured for SSL check")
	}

	port := 443
	if p, ok := check.Config["port"].(float64); ok && p > 0 {
		port = int(p)
	}

	warningDays := 30
	if w, ok := check.Config["warning_days"].(float64); ok {
		warningDays = int(w)
	}

	criticalDays := 14
	if c, ok := check.Config["critical_days"].(float64); ok {
		criticalDays = int(c)
	}

	allowSelfSigned := false
	if v, ok := check.Config["allow_self_signed"].(bool); ok {
		allowSelfSigned = v
	}

	checkOCSPFlag := false
	if v, ok := check.Config["check_ocsp"].(bool); ok {
		checkOCSPFlag = v
	}

	timeout := 10 * time.Second
	if t, ok := check.Config["timeout"].(float64); ok && t > 0 {
		timeout = time.Duration(t) * time.Second
	}

	start := time.Now()
	result := performSSLCheck(host.Hostname, targetHost, check.Name, port, warningDays, criticalDays, allowSelfSigned, checkOCSPFlag, timeout)
	durationMs := int(time.Since(start).Milliseconds())
	result.DurationMs = &durationMs
	result.CheckType = "ssl_certificate"
	return result
}

func performSSLCheck(hostname, targetHost, checkName string, port, warningDays, criticalDays int, allowSelfSigned, checkOCSPFlag bool, timeout time.Duration) CheckResult {
	addr := fmt.Sprintf("%s:%d", targetHost, port)

	dialer := &net.Dialer{Timeout: timeout}
	conn, err := tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{
		InsecureSkipVerify: true,
		ServerName:         targetHost,
	})
	if err != nil {
		return CheckResult{
			Host:    hostname,
			Name:    checkName,
			Status:  "CRITICAL",
			Message: fmt.Sprintf("TLS connection failed to %s: %s", addr, err),
		}
	}
	defer conn.Close()

	certs := conn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return CheckResult{
			Host:    hostname,
			Name:    checkName,
			Status:  "CRITICAL",
			Message: fmt.Sprintf("No certificates presented by %s", addr),
		}
	}

	leaf := certs[0]
	now := time.Now()

	daysUntilExpiry := int(time.Until(leaf.NotAfter).Hours() / 24)
	daysValue := float64(daysUntilExpiry)

	isSelfSigned := leaf.Issuer.String() == leaf.Subject.String()
	hostnameValid := leaf.VerifyHostname(targetHost) == nil

	// Chain validation
	intermediates := x509.NewCertPool()
	for _, ic := range certs[1:] {
		intermediates.AddCert(ic)
	}
	_, chainErr := leaf.Verify(x509.VerifyOptions{
		DNSName:       targetHost,
		Intermediates: intermediates,
		CurrentTime:   now,
	})
	chainValid := chainErr == nil

	sigAlgo := leaf.SignatureAlgorithm.String()
	weakAlgo := sslIsWeakAlgorithm(leaf.SignatureAlgorithm)

	keyType, keySize := sslGetKeyInfo(leaf)
	weakKey := keyType == "RSA" && keySize < 2048

	ocspStatus := ""
	if checkOCSPFlag {
		ocspStatus = sslCheckOCSP(leaf, certs, timeout)
	}

	sans := leaf.DNSNames
	serialNumber := sslFormatSerial(leaf.SerialNumber)

	issuerName := leaf.Issuer.CommonName
	if issuerName == "" && len(leaf.Issuer.Organization) > 0 {
		issuerName = leaf.Issuer.Organization[0]
	}

	metadata := map[string]any{
		"subject":             leaf.Subject.CommonName,
		"issuer":              issuerName,
		"sans":                sans,
		"not_before":          leaf.NotBefore.UTC().Format(time.RFC3339),
		"not_after":           leaf.NotAfter.UTC().Format(time.RFC3339),
		"days_until_expiry":   daysUntilExpiry,
		"is_self_signed":      isSelfSigned,
		"hostname_valid":      hostnameValid,
		"chain_valid":         chainValid,
		"signature_algorithm": sigAlgo,
		"key_type":            keyType,
		"key_size":            keySize,
		"serial_number":       serialNumber,
	}
	if ocspStatus != "" {
		metadata["ocsp_status"] = ocspStatus
	}

	expiryDate := leaf.NotAfter.Format("2006-01-02")
	status, message := sslEvaluateStatus(
		targetHost, daysUntilExpiry, warningDays, criticalDays,
		hostnameValid, chainValid, isSelfSigned, allowSelfSigned,
		weakAlgo, weakKey, ocspStatus,
		leaf, issuerName, expiryDate,
	)

	return CheckResult{
		Host:     hostname,
		Name:     checkName,
		Status:   status,
		Value:    &daysValue,
		Unit:     "days",
		Message:  message,
		Metadata: metadata,
	}
}

func sslEvaluateStatus(
	host string, daysUntilExpiry, warningDays, criticalDays int,
	hostnameValid, chainValid, isSelfSigned, allowSelfSigned bool,
	weakAlgo, weakKey bool, ocspStatus string,
	leaf *x509.Certificate, issuerName, expiryDate string,
) (string, string) {
	// CRITICAL conditions
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
		kt, ks := sslGetKeyInfo(leaf)
		return "WARNING", fmt.Sprintf("Weak key: %s %d bit (expires %s)", kt, ks, expiryDate)
	}

	return "OK", fmt.Sprintf("Valid for %d days (expires %s), issued by %s", daysUntilExpiry, expiryDate, issuerName)
}

func sslIsWeakAlgorithm(algo x509.SignatureAlgorithm) bool {
	switch algo {
	case x509.SHA1WithRSA, x509.ECDSAWithSHA1,
		x509.MD5WithRSA, x509.MD2WithRSA:
		return true
	}
	return false
}

func sslGetKeyInfo(cert *x509.Certificate) (string, int) {
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

func sslCheckOCSP(leaf *x509.Certificate, chain []*x509.Certificate, timeout time.Duration) string {
	if len(leaf.OCSPServer) == 0 {
		return ""
	}
	if len(chain) < 2 {
		return "unknown"
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

func sslFormatSerial(serial *big.Int) string {
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
