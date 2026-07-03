
function AvatarEditor({
  userId,
  tenantId,
  avatarUrl,
  canEdit,
  onUpdated,
  label,
}: {
  userId: string;
  tenantId: string | null;
  avatarUrl: string | null;
  canEdit: boolean;
  onUpdated: () => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const handlePick = async (file: File) => {
    if (!tenantId) {
      toast.error("Brak kontekstu tenanta");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Plik za duży (max 5 MB)");
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${tenantId}/users/${userId}/avatar-${Date.now()}.${ext}`;
      const { data: signed, error: signErr } = await supabase.storage
        .from("media")
        .createSignedUploadUrl(path);
      if (signErr || !signed) throw signErr ?? new Error("sign failed");

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signed.signedUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.setRequestHeader("x-upsert", "true");
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("network"));
        xhr.send(file);
      });

      const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
      const { error: updErr } = await supabase.rpc("admin_update_user_avatar", {
        _user_id: userId,
        _avatar_url: pub.publicUrl,
      });
      if (updErr) throw updErr;
      toast.success("Zapisano");
      onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative group">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="w-24 h-24 md:w-28 md:h-28 rounded-md object-cover border-4 border-card shadow-sm"
        />
      ) : (
        <div className="w-24 h-24 md:w-28 md:h-28 rounded-md bg-muted border-4 border-card" />
      )}
      {canEdit && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handlePick(f);
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="absolute inset-0 rounded-md flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-100"
            aria-label={label}
            title={label}
          >
            {busy ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <Camera className="w-6 h-6" />
            )}
          </button>
        </>
      )}
    </div>
  );
}
