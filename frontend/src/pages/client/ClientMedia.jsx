import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatErr, API_BASE } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Upload, Trash2, Image as ImageIcon, Film, Loader2, FolderPlus } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_FOLDER = "default";

export default function ClientMedia() {
  const [media, setMedia] = useState([]);
  const [folders, setFolders] = useState([DEFAULT_FOLDER]);
  const [currentFolder, setCurrentFolder] = useState(DEFAULT_FOLDER);
  const [newFolder, setNewFolder] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const loadMedia = useCallback(async () => {
    try {
      const res = await api.get("/client/media");
      const items = res.data || [];
      setMedia(items);
      const derivedFolders = Array.from(new Set(items.map((item) => item.folder || DEFAULT_FOLDER)));
      setFolders(derivedFolders.length ? derivedFolders : [DEFAULT_FOLDER]);
      setCurrentFolder((prev) => (derivedFolders.includes(prev) ? prev : (derivedFolders[0] || DEFAULT_FOLDER)));
    } catch {}
  }, []);

  useEffect(() => {
    loadMedia();
  }, [loadMedia]);

  const filtered = useMemo(
    () => media.filter((item) => (item.folder || DEFAULT_FOLDER) === currentFolder),
    [media, currentFolder],
  );

  const isImageMedia = (item) => item?.kind === "image" || (item?.content_type || "").startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(item?.original_filename || item?.name || "");

  const createFolder = () => {
    const name = newFolder.trim();
    if (!name) {
      toast.error("Folder name required");
      return;
    }
    if (folders.includes(name)) {
      toast.error("Folder already exists");
      return;
    }
    setFolders((prev) => [...prev, name]);
    setCurrentFolder(name);
    setNewFolder("");
    toast.success(`Created folder "${name}"`);
  };

  const upload = async (files) => {
    if (!files?.length || uploading) return;
    setUploading(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", currentFolder);
        fd.append("zone", "main");
        fd.append("name", file.name);
        await api.post("/client/media", fd, { headers: { "Content-Type": "multipart/form-data" } });
      }
      toast.success(`${files.length} file(s) uploaded to ${currentFolder}`);
      await loadMedia();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this media?")) return;
    try {
      await api.delete(`/client/media/${id}`);
      toast.success("Deleted");
      await loadMedia();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    }
  };

  return (
    <div data-testid="client-media-page">
      <PageHeader
        overline="Client / Media"
        title="Media library."
        subtitle="Create folders, upload files into them, then use those files while building playlists."
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => upload(Array.from(e.target.files || []))}
          data-testid="media-file-input"
        />
        <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="upload-btn">
          {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</> : <><Upload className="w-4 h-4 mr-2" /> Upload</>}
        </Button>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          <div className="rounded-sm border border-[#E5E7EB] bg-white p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Create Folder</div>
            <div className="flex gap-2">
              <Input
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                placeholder="Folder name"
                className="rounded-sm"
                data-testid="new-folder-input"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), createFolder())}
              />
              <Button type="button" size="sm" onClick={createFolder} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="create-folder-btn">
                <FolderPlus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="rounded-sm border border-[#E5E7EB] bg-white p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] px-2 py-1">Folders</div>
            <div className="space-y-1 max-h-[480px] overflow-y-auto">
              {folders.map((folder) => (
                <button
                  key={folder}
                  type="button"
                  onClick={() => setCurrentFolder(folder)}
                  className={`w-full text-left px-3 py-2 rounded-sm border transition flex items-center justify-between ${currentFolder === folder ? "bg-[#111827] text-white border-[#111827]" : "bg-white text-[#111827] border-[#E5E7EB] hover:bg-[#F9FAFB]"}`}
                  data-testid={`folder-tab-${folder}`}
                >
                  <span className="text-sm font-semibold truncate">{folder}</span>
                  <span className={`text-[10px] font-mono ${currentFolder === folder ? "text-white/70" : "text-[#9CA3AF]"}`}>{media.filter((m) => (m.folder || DEFAULT_FOLDER) === folder).length}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="rounded-sm border border-[#E5E7EB] bg-white p-3 mb-4 text-xs text-[#6B7280]">
            Showing folder <span className="font-semibold text-[#111827]">{currentFolder}</span>. Files uploaded here will be available when building playlists.
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {filtered.length === 0 && (
              <div className="col-span-full text-center py-12 text-sm text-[#6B7280] border border-dashed border-[#E5E7EB] rounded-sm">
                No media in this folder. Upload images or videos to get started.
              </div>
            )}
            {filtered.map((m) => (
              <div key={m.id} className="dense-card bg-white border border-[#E5E7EB] rounded-sm overflow-hidden group relative" data-testid={`media-${m.id}`}>
                <div className="aspect-square bg-[#F3F4F6] overflow-hidden">
                  {isImageMedia(m) ? (
                    <img src={`${API_BASE}/media/serve/${m.id}`} alt={m.name} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-[#111827]">
                      <Film className="w-10 h-10 text-white/50" />
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <div className="flex items-center gap-1.5">
                    {isImageMedia(m) ? <ImageIcon className="w-3 h-3 text-[#6B7280]" /> : <Film className="w-3 h-3 text-[#6B7280]" />}
                    <div className="text-xs font-semibold truncate flex-1">{m.name}</div>
                  </div>
                  <div className="text-[10px] text-[#9CA3AF] font-mono mt-1">{(m.size / 1024).toFixed(1)} KB</div>
                  <div className="text-[10px] text-[#9CA3AF] mt-1 truncate">{m.folder || DEFAULT_FOLDER}</div>
                </div>
                <button onClick={() => remove(m.id)} className="absolute top-1 right-1 w-7 h-7 bg-white/90 border border-[#E5E7EB] rounded-sm flex items-center justify-center text-red-600 opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`delete-media-${m.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}



