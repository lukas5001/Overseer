package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/lukas5001/overseer-agent/internal/client"
	"github.com/lukas5001/overseer-agent/internal/config"
	"github.com/lukas5001/overseer-agent/internal/types"
	"github.com/lukas5001/overseer-agent/internal/version"
)

func main() {
	configPath := flag.String("config", config.DefaultConfigPath(), "Path to config file")
	showVersion := flag.Bool("version", false, "Show version and exit")
	runForeground := flag.Bool("run", false, "Run in foreground mode")
	flag.Parse()

	if *showVersion {
		fmt.Printf("Overseer Agent %s (built %s, commit %s)\n", version.Version, version.BuildTime, version.GitCommit)
		os.Exit(0)
	}

	// On Windows, detect if running as service (will be implemented in Prompt 5)
	// For now, always run in foreground
	_ = runForeground

	if err := run(*configPath); err != nil {
		fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
		os.Exit(1)
	}
}

func run(configPath string) error {
	// 1. Load local config
	cfg, err := config.Load(configPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	// 2. Setup logger
	logger := setupLogger(cfg.LogLevel, cfg.LogFile)
	logger.Info("Overseer Agent starting",
		"version", version.Version,
		"os", runtime.GOOS,
		"arch", runtime.GOARCH,
		"config", configPath,
	)

	// 3. Create HTTP client
	httpClient := client.New(cfg.Server, cfg.Token, cfg.InsecureSkipVerify, logger)

	// 4. Fetch remote config with retry
	var remoteCfg *types.RemoteConfig
	for attempt := 1; attempt <= 5; attempt++ {
		remoteCfg, err = httpClient.FetchConfig()
		if err == nil {
			break
		}
		logger.Warn("failed to fetch remote config, retrying",
			"attempt", attempt,
			"error", err,
		)
		if attempt < 5 {
			time.Sleep(time.Duration(attempt*2) * time.Second)
		}
	}
	if err != nil {
		return fmt.Errorf("fetch remote config after 5 attempts: %w", err)
	}

	logger.Info("Connected to server",
		"server", cfg.Server,
		"host", remoteCfg.Hostname,
		"host_id", remoteCfg.HostID,
		"checks", len(remoteCfg.Checks),
	)

	// 5. Send initial heartbeat
	hostname, _ := os.Hostname()
	if err := httpClient.SendHeartbeat(&types.HeartbeatInfo{
		AgentVersion: version.Version,
		OS:           runtime.GOOS,
		Hostname:     hostname,
	}); err != nil {
		logger.Warn("initial heartbeat failed", "error", err)
	}

	// 6. Setup context with signal handling
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	logger.Info("Agent ready — waiting for scheduler (Prompt 3+4)",
		"checks_configured", len(remoteCfg.Checks),
	)

	// 7. Main loop placeholder (will be replaced in Prompt 4)
	// For now: heartbeat every 60s, config refresh every 5min
	heartbeatTicker := time.NewTicker(60 * time.Second)
	defer heartbeatTicker.Stop()

	configRefreshInterval := time.Duration(remoteCfg.ConfigIntervalSeconds) * time.Second
	if configRefreshInterval < 60*time.Second {
		configRefreshInterval = 300 * time.Second
	}
	configTicker := time.NewTicker(configRefreshInterval)
	defer configTicker.Stop()

	for {
		select {
		case <-sigCh:
			logger.Info("Shutdown signal received, stopping gracefully...")
			cancel()
			logger.Info("Agent stopped gracefully")
			return nil

		case <-ctx.Done():
			return nil

		case <-heartbeatTicker.C:
			if err := httpClient.SendHeartbeat(&types.HeartbeatInfo{
				AgentVersion: version.Version,
				OS:           runtime.GOOS,
				Hostname:     hostname,
			}); err != nil {
				logger.Warn("heartbeat failed", "error", err)
			} else {
				logger.Debug("heartbeat sent")
			}

		case <-configTicker.C:
			newCfg, err := httpClient.FetchConfig()
			if err != nil {
				logger.Warn("config refresh failed", "error", err)
				continue
			}
			if len(newCfg.Checks) != len(remoteCfg.Checks) {
				logger.Info("config refreshed", "checks", len(newCfg.Checks))
			}
			remoteCfg = newCfg
		}
	}
}

func setupLogger(level, logFile string) *slog.Logger {
	var lvl slog.Level
	switch level {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}

	var writer *os.File
	if logFile != "" {
		f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: cannot open log file %s: %v, using stdout\n", logFile, err)
			writer = os.Stdout
		} else {
			writer = f
		}
	} else {
		writer = os.Stdout
	}

	handler := slog.NewTextHandler(writer, &slog.HandlerOptions{Level: lvl})
	return slog.New(handler)
}
