package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPersistenceProbePreservesExistingDataAndCleansTemporaryFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "snapshot.json")
	const contents = "existing synthetic data must not be touched"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := CheckPersistencePath(path); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != contents {
		t.Fatal("probe modified the configured data file")
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 1 || files[0].Name() != "snapshot.json" {
		t.Fatal("probe left temporary files behind")
	}
}

func TestPersistenceProbeCreatesPrivateDirectoryWithoutCreatingSnapshot(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "new-data")
	path := filepath.Join(dir, "snapshot.json")
	if err := CheckPersistencePath(path); err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 0 {
		t.Fatal("probe created a snapshot or left temporary files behind")
	}
	info, err := os.Stat(dir)
	if err != nil || info.Mode().Perm() != 0o700 {
		t.Fatal("new data directory is not private")
	}
}

func TestPersistenceProbeRejectsBadPaths(t *testing.T) {
	parentFile := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(parentFile, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"", filepath.Join(parentFile, "snapshot.json")} {
		if err := CheckPersistencePath(path); err == nil {
			t.Fatal("probe accepted an unusable data path")
		}
	}
}

func TestAtomicPersistenceWritesArePrivateAndReplaceExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "probe.tmp")
	if err := os.WriteFile(path, []byte("before"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeFileAtomic(path, []byte("after")); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatal("atomic replacement was not private")
	}
	contents, err := os.ReadFile(path)
	if err != nil || string(contents) != "after" {
		t.Fatal("atomic replacement failed")
	}
}
