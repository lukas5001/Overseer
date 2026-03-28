//go:build windows

package logcollector

import "os"

func getInode(_ os.FileInfo) uint64 {
	// Windows doesn't have inodes — always return 0.
	// Rotation detection falls back to size comparison.
	return 0
}
