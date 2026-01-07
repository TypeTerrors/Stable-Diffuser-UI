package services

import (
	"encoding/json"
	"sync"

	"github.com/charmbracelet/log"
)

type WSEvent struct {
	Type           string `json:"type"` // only completed/failed
	JobID          string `json:"jobId"`
	ModelVersionID int64  `json:"modelVersionId"`
	Message        string `json:"message,omitempty"`
	Path           string `json:"path,omitempty"`
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string]*WSClient
	logger  *log.Logger
}

func safeCloseBytes(ch chan []byte) {
	defer func() {
		_ = recover()
	}()
	close(ch)
}

func NewHub() *Hub {
	return &Hub{
		clients: map[string]*WSClient{},
		logger:  log.With("component", "hub"),
	}
}

func (h *Hub) Add(c *WSClient) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if old, ok := h.clients[c.id]; ok {
		h.logger.Info("ws replacing client", "clientId", c.id)
		safeCloseBytes(old.send)
		old.conn.Close()
	}

	h.clients[c.id] = c
	h.logger.Info("ws client added", "clientId", c.id, "clients", len(h.clients))
}

func (h *Hub) Remove(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if c, ok := h.clients[id]; ok {
		delete(h.clients, id)
		safeCloseBytes(c.send)
		c.conn.Close()
		h.logger.Info("ws client removed", "clientId", id, "clients", len(h.clients))
	}
}

func (h *Hub) Shutdown() {
	h.mu.Lock()
	clients := h.clients
	h.clients = map[string]*WSClient{}
	h.mu.Unlock()

	for _, c := range clients {
		safeCloseBytes(c.send)
		c.conn.Close()
	}
	h.logger.Info("ws hub shutdown", "clients", len(clients))
}

func (h *Hub) SendTo(clientId string, event WSEvent) {
	h.mu.RLock()
	c := h.clients[clientId]
	h.mu.RUnlock()

	if c == nil {
		h.logger.Debug("ws send skipped; client missing", "clientId", clientId, "type", event.Type)
		return
	}

	b, _ := json.Marshal(event)
	select {
	case c.send <- b:
	default:
		h.logger.Warn("ws send queue full; dropping client", "clientId", clientId, "type", event.Type)
		h.Remove(clientId)
	}
}
