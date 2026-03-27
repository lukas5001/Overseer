package main

import (
	"crypto/x509"
	"math/big"
	"strings"
	"testing"
	"time"
)

func TestCollectorSSL_ValidDomain(t *testing.T) {
	host := HostConfig{Hostname: "google.com", IPAddress: "google.com"}
	check := CheckConfig{
		Name: "ssl_test",
		Type: "ssl_certificate",
		Config: map[string]interface{}{
			"host":          "google.com",
			"port":          float64(443),
			"warning_days":  float64(5),
			"critical_days": float64(2),
		},
	}
	result := doSSLCertificateCheck(host, check)
	if result.Status != "OK" {
		t.Errorf("expected OK for google.com, got %s: %s", result.Status, result.Message)
	}
	if result.Value == nil || *result.Value <= 0 {
		t.Errorf("expected positive days value, got %v", result.Value)
	}
	if result.Metadata == nil {
		t.Fatal("expected metadata, got nil")
	}
	if result.CheckType != "ssl_certificate" {
		t.Errorf("expected check_type ssl_certificate, got %s", result.CheckType)
	}
	if result.DurationMs == nil {
		t.Error("expected DurationMs to be set")
	}
}

func TestCollectorSSL_WarningDays(t *testing.T) {
	host := HostConfig{Hostname: "google.com"}
	check := CheckConfig{
		Name: "ssl_test",
		Type: "ssl_certificate",
		Config: map[string]interface{}{
			"host":          "google.com",
			"warning_days":  float64(9999),
			"critical_days": float64(1),
		},
	}
	result := doSSLCertificateCheck(host, check)
	if result.Status != "WARNING" {
		t.Errorf("expected WARNING, got %s: %s", result.Status, result.Message)
	}
}

func TestCollectorSSL_ConnectionTimeout(t *testing.T) {
	host := HostConfig{Hostname: "unreachable"}
	check := CheckConfig{
		Name: "ssl_test",
		Type: "ssl_certificate",
		Config: map[string]interface{}{
			"host":    "192.0.2.1",
			"timeout": float64(2),
		},
	}
	result := doSSLCertificateCheck(host, check)
	if result.Status != "CRITICAL" {
		t.Errorf("expected CRITICAL for unreachable, got %s: %s", result.Status, result.Message)
	}
}

func TestCollectorSSL_FallbackToHostIP(t *testing.T) {
	// When no host in config, should fall back to host.IPAddress
	host := HostConfig{Hostname: "test-host", IPAddress: "google.com"}
	check := CheckConfig{
		Name: "ssl_test",
		Type: "ssl_certificate",
		Config: map[string]interface{}{
			"warning_days":  float64(5),
			"critical_days": float64(2),
		},
	}
	result := doSSLCertificateCheck(host, check)
	if result.Status != "OK" {
		t.Errorf("expected OK with IP fallback, got %s: %s", result.Status, result.Message)
	}
}

func TestCollectorSSL_NoHostConfigured(t *testing.T) {
	host := HostConfig{Hostname: ""}
	check := CheckConfig{
		Name:   "ssl_test",
		Type:   "ssl_certificate",
		Config: map[string]interface{}{},
	}
	result := doSSLCertificateCheck(host, check)
	if result.Status != "UNKNOWN" {
		t.Errorf("expected UNKNOWN for no host, got %s: %s", result.Status, result.Message)
	}
}

func TestCollectorSSL_MetadataPresent(t *testing.T) {
	host := HostConfig{Hostname: "google.com"}
	check := CheckConfig{
		Name: "ssl_test",
		Type: "ssl_certificate",
		Config: map[string]interface{}{
			"host":          "google.com",
			"warning_days":  float64(5),
			"critical_days": float64(2),
		},
	}
	result := doSSLCertificateCheck(host, check)
	if result.Metadata == nil {
		t.Fatal("expected metadata")
	}
	requiredFields := []string{
		"subject", "issuer", "not_after", "days_until_expiry",
		"hostname_valid", "chain_valid", "key_type", "key_size",
	}
	for _, f := range requiredFields {
		if _, ok := result.Metadata[f]; !ok {
			t.Errorf("metadata missing: %s", f)
		}
	}
}

// Unit tests for collector-specific helpers

func TestSSLEvaluateStatus_OK(t *testing.T) {
	cert := &x509.Certificate{
		NotAfter:           time.Now().Add(90 * 24 * time.Hour),
		SignatureAlgorithm: x509.SHA256WithRSA,
	}
	expiryDate := cert.NotAfter.Format("2006-01-02")
	status, msg := sslEvaluateStatus(
		"test.com", 90, 30, 14,
		true, true, false, false,
		false, false, "",
		cert, "Let's Encrypt", expiryDate,
	)
	if status != "OK" {
		t.Errorf("expected OK, got %s", status)
	}
	if !strings.Contains(msg, "Valid for 90 days") {
		t.Errorf("unexpected message: %s", msg)
	}
}

func TestSSLEvaluateStatus_Expired(t *testing.T) {
	cert := &x509.Certificate{
		NotAfter:           time.Now().Add(-3 * 24 * time.Hour),
		SignatureAlgorithm: x509.SHA256WithRSA,
	}
	expiryDate := cert.NotAfter.Format("2006-01-02")
	status, _ := sslEvaluateStatus(
		"test.com", -3, 30, 14,
		true, true, false, false,
		false, false, "",
		cert, "CA", expiryDate,
	)
	if status != "CRITICAL" {
		t.Errorf("expected CRITICAL for expired, got %s", status)
	}
}

func TestSSLFormatSerial(t *testing.T) {
	result := sslFormatSerial(big.NewInt(255))
	if result != "ff" {
		t.Errorf("expected ff, got %s", result)
	}
	result = sslFormatSerial(big.NewInt(256))
	if result != "01:00" {
		t.Errorf("expected 01:00, got %s", result)
	}
}

func TestSSLIsWeakAlgorithm(t *testing.T) {
	if sslIsWeakAlgorithm(x509.SHA256WithRSA) {
		t.Error("SHA256 should not be weak")
	}
	if !sslIsWeakAlgorithm(x509.SHA1WithRSA) {
		t.Error("SHA1 should be weak")
	}
}
