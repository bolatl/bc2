// Package repository provides isolated in-memory aggregate stores. Service-level
// transactions serialize related updates; callers never receive stored pointers.
package repository

import "sync"

type Memory[T any] struct {
	mu    sync.RWMutex
	data  map[string]T
	clone func(T) T
}

func New[T any](clone func(T) T) *Memory[T] {
	return &Memory[T]{data: make(map[string]T), clone: clone}
}
func (r *Memory[T]) Get(id string) (T, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	v, ok := r.data[id]
	if ok {
		v = r.clone(v)
	}
	return v, ok
}
func (r *Memory[T]) Put(id string, v T) { r.mu.Lock(); defer r.mu.Unlock(); r.data[id] = r.clone(v) }
func (r *Memory[T]) Delete(id string)   { r.mu.Lock(); defer r.mu.Unlock(); delete(r.data, id) }
func (r *Memory[T]) All() []T {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]T, 0, len(r.data))
	for _, v := range r.data {
		out = append(out, r.clone(v))
	}
	return out
}
