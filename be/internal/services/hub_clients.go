package services

import (
	"time"

	"github.com/charmbracelet/log"
	"github.com/gofiber/contrib/websocket"
)

type WSClient struct {
	id   string
	conn *websocket.Conn
	send chan []byte
}

func (c *WSClient) writeLoop() {
	logger := log.With("component", "wsclient", "clientId", c.id)
	ping := time.NewTicker(10 * time.Second)
	defer ping.Stop()

	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				logger.Debug("send channel closed")
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				logger.Debug("write message failed", "err", err)
				return
			}
		case <-ping.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				logger.Debug("ping failed", "err", err)
				return
			}
		}
	}
}

func (c *WSClient) readLoop(onDone func()) {
	logger := log.With("component", "wsclient", "clientId", c.id)
	defer onDone()
	c.conn.SetReadLimit(1 << 20)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			logger.Debug("read loop ended", "err", err)
			return
		}
	}
}
