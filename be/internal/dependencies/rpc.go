package dependencies

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/charmbracelet/log"
)

type ConversationSink interface {
	SendMessage(username string, message []byte) bool
}

type Rpc struct {
	ctx    *context.Context
	cancel context.CancelFunc
	conn   *grpc.ClientConn
	peer   string
	logger *log.Logger

	// technicall the conversation manager responsbile for sending messages on client websocket
	sink ConversationSink
}

func NewRpc(peer, port string, sink ConversationSink) (*Rpc, error) {
	addr := fmt.Sprint(peer, ":", port)
	logger := log.With("component", "rpc", "peer", addr)
	logger.Info("rpc connecting")

	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)

	conn, err := grpc.DialContext(
		ctx,
		addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		cancel()
		logger.Error("rpc connect failed", "err", err)
		return nil, fmt.Errorf("error creating newrpc: %w", err)
	}
	logger.Info("rpc connected")

	return &Rpc{
		ctx:    &ctx,
		conn:   conn,
		cancel: cancel,
		peer:   addr,
		logger: logger,
		sink:   sink,
	}, nil
}

func (r *Rpc) Close() {
	if r.logger != nil {
		r.logger.Info("rpc closing")
	}
	r.cancel()
	r.conn.Close()
}
