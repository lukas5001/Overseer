package heartbeat

import (
	"context"
	"log/slog"
	"os"
	"runtime"
	"time"

	"github.com/lukas5001/overseer-agent/internal/client"
	"github.com/lukas5001/overseer-agent/internal/types"
	"github.com/lukas5001/overseer-agent/internal/version"
)

// Run sends heartbeats every 60 seconds until ctx is cancelled
func Run(ctx context.Context, c *client.Client, logger *slog.Logger) {
	hostname, _ := os.Hostname()

	// Send initial heartbeat immediately
	send(c, hostname, logger)

	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			send(c, hostname, logger)
		}
	}
}

func send(c *client.Client, hostname string, logger *slog.Logger) {
	info := &types.HeartbeatInfo{
		AgentVersion: version.Version,
		OS:           runtime.GOOS,
		Hostname:     hostname,
	}
	if err := c.SendHeartbeat(info); err != nil {
		logger.Warn("heartbeat failed", "error", err)
	} else {
		logger.Debug("heartbeat sent")
	}
}
