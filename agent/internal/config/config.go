package config

import (
	"fmt"
	"os"
	"runtime"

	"gopkg.in/yaml.v3"
)

// Config holds the local agent configuration loaded from YAML
type Config struct {
	Server             string `yaml:"server"`              // https://overseer.example.com
	Token              string `yaml:"token"`               // overseer_agent_xxxxx
	LogLevel           string `yaml:"log_level"`           // debug, info, warn, error (default: info)
	LogFile            string `yaml:"log_file"`            // optional, default: stdout
	InsecureSkipVerify bool   `yaml:"insecure_skip_verify"` // skip TLS cert verification
}

// DefaultConfigPath returns the default config file path for the current OS
func DefaultConfigPath() string {
	if runtime.GOOS == "windows" {
		return `C:\ProgramData\Overseer\Agent\config.yaml`
	}
	return "/etc/overseer-agent/config.yaml"
}

// Load reads and parses the YAML config from the given path
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("cannot read config file %s: %w", path, err)
	}

	cfg := &Config{
		LogLevel: "info",
	}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("cannot parse config file %s: %w", path, err)
	}

	if cfg.Server == "" {
		return nil, fmt.Errorf("config: 'server' is required")
	}
	if cfg.Token == "" {
		return nil, fmt.Errorf("config: 'token' is required")
	}

	return cfg, nil
}
