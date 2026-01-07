package mediator

import (
	"be/config"
	"be/internal/dependencies"
	"be/internal/services"
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/charmbracelet/log"
)

type App struct {
	api *services.Api
	rpc *dependencies.Rpc

	hub *services.Hub
	dl  *services.DownloaderService

	ctx    context.Context
	cancel context.CancelFunc
	// settings
	Config *config.Config
}

func NewApp(config config.Config) (*App, error) {
	log.Info("app init", "component", "mediator", "env", config.Env, "apiPort", config.Api.Port, "rpcPeer", config.Rpc.Peer, "rpcPort", config.Rpc.Port)

	rpc, err := dependencies.NewRpc(config.Rpc.Peer, config.Rpc.Port)
	if err != nil {
		return nil, fmt.Errorf("error creating newapp: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	hub := services.NewHub()
	dl := services.NewDownloaderService(hub, config.Api.Dl, ctx)
	api := services.NewApi(rpc, config.Api, hub, dl)

	return &App{
		api:    api,
		rpc:    rpc,
		hub:    hub,
		dl:     dl,
		ctx:    ctx,
		cancel: cancel,
	}, nil
}

func (a *App) Run() error {
	log.Info("app run", "component", "mediator")
	a.dl.Run()

	errCh := make(chan error, 1)
	go func() {
		errCh <- a.api.Start()
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	select {
	case <-sigCh:
		log.Info("shutdown requested", "component", "mediator", "reason", "signal")
		a.Shutdown()
		return nil
	case err := <-errCh:
		log.Error("api exited", "component", "mediator", "err", err)
		a.Shutdown()
		return err
	case <-a.ctx.Done():
		log.Info("shutdown requested", "component", "mediator", "reason", "context")
		a.Shutdown()
		return a.ctx.Err()
	}
}

func (a *App) Shutdown() {
	log.Info("shutdown starting", "component", "mediator")

	a.cancel()
	log.Info("downloader shutdown", "component", "mediator")
	a.dl.Shutdown()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	log.Info("api shutdown", "component", "mediator")
	_ = a.api.Shutdown(shutdownCtx)
	cancel()

	log.Info("hub shutdown", "component", "mediator")
	a.hub.Shutdown()
	log.Info("rpc close", "component", "mediator")
	a.rpc.Close()
	log.Info("shutdown complete", "component", "mediator")
}
