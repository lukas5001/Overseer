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
	"github.com/lukas5001/overseer-agent/internal/heartbeat"
	"github.com/lukas5001/overseer-agent/internal/scheduler"
	"github.com/lukas5001/overseer-agent/internal/sender"
	"github.com/lukas5001/overseer-agent/internal/service"
	"github.com/lukas5001/overseer-agent/internal/types"
	"github.com/lukas5001/overseer-agent/internal/version"
)

func main() {
	configPath := flag.String("config", config.DefaultConfigPath(), "Path to config file")
	showVersion := flag.Bool("version", false, "Show version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("Overseer Agent %s (built %s, commit %s)\n", version.Version, version.BuildTime, version.GitCommit)
		os.Exit(0)
	}

	// Handle subcommands (install, uninstall, start, stop, status, run)
	args := flag.Args()
	if len(args) > 0 {
		if err := handleCommand(args[0], *configPath); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
		return
	}

	// Auto-detect: Windows service or foreground
	if service.IsWindowsService() {
		if err := service.RunAsService(func() error {
			return run(*configPath)
		}); err != nil {
			fmt.Fprintf(os.Stderr, "service error: %v\n", err)
			os.Exit(1)
		}
	} else {
		if err := run(*configPath); err != nil {
			fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
			os.Exit(1)
		}
	}
}

func handleCommand(cmd, configPath string) error {
	switch cmd {
	case "run":
		return run(configPath)
	case "version":
		fmt.Printf("Overseer Agent %s (built %s, commit %s)\n", version.Version, version.BuildTime, version.GitCommit)
		return nil
	default:
		return handlePlatformCommand(cmd, configPath)
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

	// 5. Setup context with signal handling
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// 6. Create result channel and components
	resultsChan := make(chan types.CheckResult, 1000)

	sched := scheduler.New(remoteCfg.Hostname, resultsChan, logger)
	sched.UpdateConfig(remoteCfg.Checks)

	snd := sender.New(httpClient, resultsChan, remoteCfg.HostID, remoteCfg.Hostname, remoteCfg.TenantID, logger)

	// 7. Start goroutines
	go sched.Run(ctx)
	go snd.Run(ctx)
	go heartbeat.Run(ctx, httpClient, logger)

	// 8. Config refresh goroutine
	configRefreshInterval := time.Duration(remoteCfg.ConfigIntervalSeconds) * time.Second
	if configRefreshInterval < 60*time.Second {
		configRefreshInterval = 300 * time.Second
	}

	go func() {
		ticker := time.NewTicker(configRefreshInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				newCfg, err := httpClient.FetchConfig()
				if err != nil {
					logger.Warn("config refresh failed", "error", err)
					continue
				}
				if len(newCfg.Checks) != len(remoteCfg.Checks) {
					logger.Info("config refreshed", "checks", len(newCfg.Checks))
				}
				remoteCfg = newCfg
				sched.UpdateConfig(newCfg.Checks)
			}
		}
	}()

	logger.Info("Agent ready",
		"checks_configured", len(remoteCfg.Checks),
		"config_refresh", configRefreshInterval,
	)

	// 9. Wait for shutdown signal
	<-sigCh
	logger.Info("Shutdown signal received, stopping gracefully...")
	cancel()

	// Give scheduler time to finish running checks
	time.Sleep(2 * time.Second)

	// Flush pending results
	snd.Flush()

	logger.Info("Agent stopped gracefully")
	return nil
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
