package services

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
)

type Conversation struct {
	Username string
	Conn     *websocket.Conn
	Queue    chan WsConversationResponse
	res      WsConversationResponse
}

func NewWsClient(userName string, conn *websocket.Conn) *Conversation {
	return &Conversation{
		Username: userName,
		Conn:     conn,
		Queue:    make(chan WsConversationResponse, 10),
	}
}

func (w *Conversation) SendMessage(username string, token []byte) {
	w.Queue <- WsConversationResponse{
		Username: username,
		Message:  token,
	}
}
func (w *Conversation) ListenForMessages(wg *sync.WaitGroup) {
	wg.Go(func() {
		ping := time.NewTicker(10 * time.Second)
		defer ping.Stop()

		for {
			select {
			case msg, ok := <-w.Queue:
				if !ok {
					return
				}
				w.Conn.SetWriteDeadline(time.Now().Add(time.Second * 10))
				if err := w.Conn.WriteJSON(msg); err != nil {
					return
				}
			case <-ping.C:
				w.Conn.SetWriteDeadline(time.Now().Add(time.Second * 10))
				if err := w.Conn.WriteJSON(WsPing{Ping: "ping"}); err != nil {
					return
				}
			}
		}
	})
}

func (w *Conversation) Stop() {
	close(w.Queue)
}

type ConversationManager struct {
	clients map[string]*Conversation
	cancels map[string]context.CancelFunc
	mx      *sync.Mutex
	wg      *sync.WaitGroup
}

func NewConverstaionManager() *ConversationManager {
	return &ConversationManager{
		clients: make(map[string]*Conversation, 0),
		cancels: make(map[string]context.CancelFunc, 0),
		mx:      new(sync.Mutex),
		wg:      new(sync.WaitGroup),
	}
}

func (w *ConversationManager) SendMessage(username string, message []byte) bool {
	w.mx.Lock()
	defer w.mx.Unlock()

	if _, ok := w.clients[username]; ok {
		w.clients[username].SendMessage(username, message)
		return ok
	}
	return false
}

func (w *ConversationManager) SetStreamCancel(username string, cancel context.CancelFunc) {
	w.mx.Lock()
	defer w.mx.Unlock()

	if prev, ok := w.cancels[username]; ok && prev != nil {
		prev()
	}
	w.cancels[username] = cancel
}

func (w *ConversationManager) ClearStreamCancel(username string) {
	w.mx.Lock()
	defer w.mx.Unlock()
	delete(w.cancels, username)
}

func (w *ConversationManager) CancelStream(username string) bool {
	w.mx.Lock()
	defer w.mx.Unlock()

	if cancel, ok := w.cancels[username]; ok && cancel != nil {
		cancel()
		delete(w.cancels, username)
		return true
	}

	return false
}

func (w *ConversationManager) RegisterClient(username string, conn *websocket.Conn) error {
	w.mx.Lock()
	defer w.mx.Unlock()
	if _, ok := w.clients[username]; !ok {
		w.clients[username] = NewWsClient(username, conn)
		w.clients[username].ListenForMessages(w.wg)
		return nil
	}

	return fmt.Errorf("client already exists")
}

func (w *ConversationManager) RemoveClient(client string) bool {
	w.mx.Lock()
	defer w.mx.Unlock()

	if cancel, ok := w.cancels[client]; ok && cancel != nil {
		cancel()
		delete(w.cancels, client)
	}

	if wsClient, ok := w.clients[client]; ok {
		wsClient.Stop()
		delete(w.clients, client)
		return ok
	}

	return false
}

func (w *ConversationManager) Shutdown() {
	for _, cancel := range w.cancels {
		if cancel != nil {
			cancel()
		}
	}
	for _, client := range w.clients {
		client.Stop()
	}
	w.wg.Wait()
}
