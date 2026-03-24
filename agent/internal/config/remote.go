package config

import (
	"github.com/lukas5001/overseer-agent/internal/client"
	"github.com/lukas5001/overseer-agent/internal/types"
)

// FetchRemote fetches the remote configuration from the server
func FetchRemote(c *client.Client) (*types.RemoteConfig, error) {
	return c.FetchConfig()
}
