// Mole offline PC launcher: serves the game from game.zip.001, .002, ... (one zip split in raw parts,
// read in place, nothing is extracted), stores the save in save.json next to the program, and opens
// the default browser at http://127.0.0.1:18090/. The port is fixed so the page origin never changes.
package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const port = "18090"

// multi joins the split parts into one io.ReaderAt.
type multi struct {
	files []*os.File
	offs  []int64 // start offset of each part
	size  int64
}

func (m *multi) ReadAt(p []byte, off int64) (int, error) {
	n := 0
	for n < len(p) {
		o := off + int64(n)
		if o >= m.size {
			return n, io.EOF
		}
		i := sort.Search(len(m.offs), func(i int) bool { return m.offs[i] > o }) - 1
		k, err := m.files[i].ReadAt(p[n:], o-m.offs[i])
		n += k
		if err != nil && err != io.EOF {
			return n, err
		}
		if k == 0 {
			return n, io.ErrUnexpectedEOF
		}
	}
	return n, nil
}

func fail(msg string) {
	fmt.Println(msg)
	fmt.Println("按回车键退出 / press Enter to exit")
	fmt.Scanln()
	os.Exit(1)
}

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}

// injected into index.html: makes core.js save through this program (window.MoleNative is what the
// Android shell provides), so the save survives clearing the browser data.
const bridge = `<script>window.MoleNative={
load:function(){var x=new XMLHttpRequest();x.open('GET','/__save',false);x.send();return x.status==200?x.responseText:'';},
save:function(t){var x=new XMLHttpRequest();x.open('POST','/__save',false);x.send(t);return x.status==200;},
log:function(s){var x=new XMLHttpRequest();x.open('POST','/__log',true);x.send(s);}};</script>`

func main() {
	exe, _ := os.Executable()
	dir := filepath.Dir(exe)
	if wd, _ := os.Getwd(); wd != "" {
		if _, err := os.Stat(filepath.Join(dir, "game.zip.001")); err != nil {
			dir = wd
		}
	}
	url := "http://127.0.0.1:" + port + "/index.html"
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil { // probably already running: just open the page
		fmt.Println("端口 " + port + " 已被占用，可能游戏已经在运行，直接打开浏览器。")
		openBrowser(url)
		time.Sleep(2 * time.Second)
		return
	}
	m := &multi{}
	for i := 1; ; i++ {
		f, err := os.Open(filepath.Join(dir, fmt.Sprintf("game.zip.%03d", i)))
		if err != nil {
			break
		}
		st, _ := f.Stat()
		m.files = append(m.files, f)
		m.offs = append(m.offs, m.size)
		m.size += st.Size()
	}
	if len(m.files) == 0 {
		fail("找不到 game.zip.001，请把所有 game.zip.00x 文件和本程序放在同一个文件夹。")
	}
	zr, err := zip.NewReader(m, m.size)
	if err != nil {
		fail("游戏数据损坏或分卷不全（需要全部 game.zip.00x 文件）: " + err.Error())
	}
	files := map[string]*zip.File{}
	lower := map[string]*zip.File{}
	for _, f := range zr.File {
		files[f.Name] = f
		lower[strings.ToLower(f.Name)] = f
	}
	mime.AddExtensionType(".wasm", "application/wasm")
	mime.AddExtensionType(".swf", "application/x-shockwave-flash")
	mime.AddExtensionType(".js", "text/javascript; charset=utf-8")
	mime.AddExtensionType(".xml", "text/xml; charset=utf-8")
	savePath := filepath.Join(dir, "save.json")
	logf, _ := os.OpenFile(filepath.Join(dir, "game_log.txt"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	var mu sync.Mutex

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		switch p {
		case "":
			http.Redirect(w, r, "/index.html", http.StatusFound)
			return
		case "__save":
			mu.Lock()
			defer mu.Unlock()
			if r.Method == http.MethodPost {
				b, _ := io.ReadAll(r.Body)
				tmp := savePath + ".tmp"
				if os.WriteFile(tmp, b, 0644) != nil || os.Rename(tmp, savePath) != nil {
					http.Error(w, "save failed", 500)
				}
				return
			}
			b, err := os.ReadFile(savePath)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Write(b)
			return
		case "__log":
			b, _ := io.ReadAll(r.Body)
			if logf != nil {
				mu.Lock()
				logf.Write(append(b, '\n'))
				mu.Unlock()
			}
			return
		}
		f := files[p]
		if f == nil {
			f = lower[strings.ToLower(p)] // the client was made for case-insensitive Windows paths
		}
		if f == nil {
			http.NotFound(w, r)
			return
		}
		rc, err := f.Open()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer rc.Close()
		ct := mime.TypeByExtension(path.Ext(p))
		if ct == "" {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "no-cache")
		if p == "index.html" {
			b, _ := io.ReadAll(rc)
			b = bytes.Replace(b, []byte("<head>"), []byte("<head>"+bridge), 1)
			w.Write(b)
			return
		}
		w.Header().Set("Content-Length", fmt.Sprint(f.UncompressedSize64))
		io.Copy(w, rc)
	})
	fmt.Println("摩尔勇士离线版（电脑版）已启动: " + url)
	fmt.Println("存档文件: " + savePath)
	fmt.Println("玩的时候不要关闭这个窗口；关掉窗口就停止游戏。")
	go func() { time.Sleep(500 * time.Millisecond); openBrowser(url) }()
	if err := http.Serve(ln, nil); err != nil {
		fail(err.Error())
	}
}
