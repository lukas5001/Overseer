package checks

import (
	"crypto/x509"
	"math/big"
	"strings"
	"testing"
	"time"
)

func TestSSLCertificate_ValidDomain(t *testing.T) {
	config := map[string]any{
		"host":          "google.com",
		"port":          float64(443),
		"warning_days":  float64(5),
		"critical_days": float64(2),
	}
	result := checkSSLCertificate(config, nil, nil)
	if result.Status != "OK" {
		t.Errorf("expected OK for google.com, got %s: %s", result.Status, result.Message)
	}
	if result.Value == nil || *result.Value <= 0 {
		t.Errorf("expected positive days_until_expiry, got %v", result.Value)
	}
	if result.Metadata == nil {
		t.Fatal("expected metadata, got nil")
	}
	if result.Metadata["hostname_valid"] != true {
		t.Error("expected hostname_valid=true for google.com")
	}
	if result.Metadata["chain_valid"] != true {
		t.Error("expected chain_valid=true for google.com")
	}
	if !strings.Contains(result.Message, "Valid for") {
		t.Errorf("expected message to contain 'Valid for', got: %s", result.Message)
	}
	if !strings.Contains(result.Message, "expires") {
		t.Errorf("expected message to contain 'expires', got: %s", result.Message)
	}
}

func TestSSLCertificate_WarningDays(t *testing.T) {
	config := map[string]any{
		"host":          "google.com",
		"port":          float64(443),
		"warning_days":  float64(9999),
		"critical_days": float64(1),
	}
	result := checkSSLCertificate(config, nil, nil)
	if result.Status != "WARNING" {
		t.Errorf("expected WARNING with high warning_days, got %s: %s", result.Status, result.Message)
	}
}

func TestSSLCertificate_CriticalDays(t *testing.T) {
	config := map[string]any{
		"host":          "google.com",
		"port":          float64(443),
		"warning_days":  float64(99999),
		"critical_days": float64(99998),
	}
	result := checkSSLCertificate(config, nil, nil)
	if result.Status != "CRITICAL" {
		t.Errorf("expected CRITICAL with high critical_days, got %s: %s", result.Status, result.Message)
	}
}

func TestSSLCertificate_ConnectionTimeout(t *testing.T) {
	config := map[string]any{
		"host":    "192.0.2.1", // RFC 5737 TEST-NET, not routable
		"port":    float64(443),
		"timeout": float64(2),
	}
	result := checkSSLCertificate(config, nil, nil)
	if result.Status != "CRITICAL" {
		t.Errorf("expected CRITICAL for unreachable host, got %s: %s", result.Status, result.Message)
	}
	if !strings.Contains(result.Message, "TLS connection failed") {
		t.Errorf("expected connection failure message, got: %s", result.Message)
	}
}

func TestSSLCertificate_InvalidPort(t *testing.T) {
	config := map[string]any{
		"host":    "google.com",
		"port":    float64(80),
		"timeout": float64(5),
	}
	result := checkSSLCertificate(config, nil, nil)
	if result.Status != "CRITICAL" {
		t.Errorf("expected CRITICAL for non-TLS port, got %s: %s", result.Status, result.Message)
	}
}

func TestSSLCertificate_NoHost(t *testing.T) {
	config := map[string]any{}
	result := checkSSLCertificate(config, nil, nil)
	if result.Status != "UNKNOWN" {
		t.Errorf("expected UNKNOWN for missing host, got %s: %s", result.Status, result.Message)
	}
}

func TestSSLCertificate_MetadataFields(t *testing.T) {
	config := map[string]any{
		"host":          "google.com",
		"port":          float64(443),
		"warning_days":  float64(5),
		"critical_days": float64(2),
	}
	result := checkSSLCertificate(config, nil, nil)
	if result.Metadata == nil {
		t.Fatal("expected metadata, got nil")
	}

	requiredFields := []string{
		"subject", "issuer", "sans", "not_before", "not_after",
		"days_until_expiry", "is_self_signed", "hostname_valid",
		"chain_valid", "signature_algorithm", "key_type", "key_size",
		"serial_number",
	}
	for _, field := range requiredFields {
		if _, ok := result.Metadata[field]; !ok {
			t.Errorf("metadata missing field: %s", field)
		}
	}
}


func TestEvaluateSSLStatus_SelfSignedWarning(t *testing.T) {
	cert := &x509.Certificate{
		NotAfter:           time.Now().Add(90 * 24 * time.Hour),
		DNSNames:           []string{"test.example.com"},
		SignatureAlgorithm: x509.SHA256WithRSA,
	}

	status, _ := evaluateSSLStatus(
		"test.example.com", 90, 30, 14,
		true, true, true, false, // self-signed, NOT allowed
		false, false, "",
		cert, "Self",
	)
	if status != "WARNING" {
		t.Errorf("expected WARNING for self-signed, got %s", status)
	}
}

func TestEvaluateSSLStatus_SelfSignedAllowed(t *testing.T) {
	cert := &x509.Certificate{
		NotAfter:           time.Now().Add(90 * 24 * time.Hour),
		DNSNames:           []string{"test.example.com"},
		SignatureAlgorithm: x509.SHA256WithRSA,
	}

	status, _ := evaluateSSLStatus(
		"test.example.com", 90, 30, 14,
		true, true, true, true, // self-signed, allowed
		false, false, "",
		cert, "Self",
	)
	if status != "OK" {
		t.Errorf("expected OK for self-signed allowed, got %s", status)
	}
}

func TestEvaluateSSLStatus_Expired(t *testing.T) {
	cert := &x509.Certificate{
		NotAfter:           time.Now().Add(-5 * 24 * time.Hour),
		SignatureAlgorithm: x509.SHA256WithRSA,
	}

	status, msg := evaluateSSLStatus(
		"test.example.com", -5, 30, 14,
		true, true, false, false,
		false, false, "",
		cert, "Test CA",
	)
	if status != "CRITICAL" {
		t.Errorf("expected CRITICAL for expired cert, got %s", status)
	}
	if !strings.Contains(msg, "EXPIRED") {
		t.Errorf("expected EXPIRED in message, got: %s", msg)
	}
}

func TestEvaluateSSLStatus_HostnameMismatch(t *testing.T) {
	cert := &x509.Certificate{
		NotAfter:           time.Now().Add(90 * 24 * time.Hour),
		DNSNames:           []string{"other.example.com"},
		SignatureAlgorithm: x509.SHA256WithRSA,
	}

	status, msg := evaluateSSLStatus(
		"api.example.com", 90, 30, 14,
		false, true, false, false, // hostname NOT valid
		false, false, "",
		cert, "Test CA",
	)
	if status != "CRITICAL" {
		t.Errorf("expected CRITICAL for hostname mismatch, got %s", status)
	}
	if !strings.Contains(msg, "hostname mismatch") {
		t.Errorf("expected hostname mismatch message, got: %s", msg)
	}
}

func TestEvaluateSSLStatus_ChainInvalid(t *testing.T) {
	cert := &x509.Certificate{
		NotAfter:           time.Now().Add(90 * 24 * time.Hour),
		SignatureAlgorithm: x509.SHA256WithRSA,
	}

	status, msg := evaluateSSLStatus(
		"test.example.com", 90, 30, 14,
		true, false, false, false, // chain NOT valid
		false, false, "",
		cert, "Test CA",
	)
	if status != "CRITICAL" {
		t.Errorf("expected CRITICAL for invalid chain, got %s", status)
	}
	if !strings.Contains(msg, "chain validation failed") {
		t.Errorf("expected chain validation message, got: %s", msg)
	}
}

func TestEvaluateSSLStatus_OCSPRevoked(t *testing.T) {
	cert := &x509.Certificate{
		NotAfter:           time.Now().Add(90 * 24 * time.Hour),
		SignatureAlgorithm: x509.SHA256WithRSA,
	}

	status, msg := evaluateSSLStatus(
		"test.example.com", 90, 30, 14,
		true, true, false, false,
		false, false, "revoked",
		cert, "Test CA",
	)
	if status != "CRITICAL" {
		t.Errorf("expected CRITICAL for revoked cert, got %s", status)
	}
	if !strings.Contains(msg, "REVOKED") {
		t.Errorf("expected REVOKED in message, got: %s", msg)
	}
}

func TestFormatSerial(t *testing.T) {
	tests := []struct {
		input    int64
		expected string
	}{
		{255, "ff"},
		{256, "01:00"},
		{65535, "ff:ff"},
	}
	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := formatSerial(big.NewInt(tt.input))
			if result != tt.expected {
				t.Errorf("formatSerial(%d) = %s, want %s", tt.input, result, tt.expected)
			}
		})
	}
}

func TestIsWeakAlgorithm(t *testing.T) {
	if isWeakAlgorithm(x509.SHA256WithRSA) {
		t.Error("SHA256WithRSA should not be weak")
	}
	if isWeakAlgorithm(x509.SHA384WithRSA) {
		t.Error("SHA384WithRSA should not be weak")
	}
	if !isWeakAlgorithm(x509.SHA1WithRSA) {
		t.Error("SHA1WithRSA should be weak")
	}
	if !isWeakAlgorithm(x509.MD5WithRSA) {
		t.Error("MD5WithRSA should be weak")
	}
}
