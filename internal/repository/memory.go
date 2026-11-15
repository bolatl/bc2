// Package repository provides isolated in-memory aggregate stores. Service-level
// transactions serialize related updates; callers never receive stored pointers.
package repository

import "sync"

type Memory[T any] struct {
	mu       sync.RWMutex
	data     map[string]T
	clone    func(T) T
	onChange func()
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

// OnChange registers a callback run after every Put or Delete, outside the lock.
// It must not block; it exists so a background writer can persist the store.
func (r *Memory[T]) OnChange(fn func()) { r.mu.Lock(); r.onChange = fn; r.mu.Unlock() }
func (r *Memory[T]) Put(id string, v T) {
	r.mu.Lock()
	r.data[id] = r.clone(v)
	fn := r.onChange
	r.mu.Unlock()
	if fn != nil {
		fn()
	}
}
func (r *Memory[T]) Delete(id string) {
	r.mu.Lock()
	delete(r.data, id)
	fn := r.onChange
	r.mu.Unlock()
	if fn != nil {
		fn()
	}
}
func (r *Memory[T]) All() []T {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]T, 0, len(r.data))
	for _, v := range r.data {
		out = append(out, r.clone(v))
	}
	return out
}
