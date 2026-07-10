DROP POLICY IF EXISTS "chat attachments member read" ON storage.objects;
CREATE POLICY "chat attachments member read" ON storage.objects FOR SELECT TO authenticated USING (
 bucket_id='chat-attachments' AND array_length(storage.foldername(name),1)>=3
 AND public.is_conversation_member(((storage.foldername(name))[2])::uuid,(SELECT auth.uid()))
);
DROP POLICY IF EXISTS "chat attachments member upload" ON storage.objects;
CREATE POLICY "chat attachments member upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
 bucket_id='chat-attachments' AND array_length(storage.foldername(name),1)=3
 AND (storage.foldername(name))[1]=(SELECT public.current_tenant_id()::text)
 AND (storage.foldername(name))[3]=(SELECT auth.uid()::text)
 AND public.is_conversation_member(((storage.foldername(name))[2])::uuid,(SELECT auth.uid()))
);
DROP POLICY IF EXISTS "chat attachments owner delete" ON storage.objects;
CREATE POLICY "chat attachments owner delete" ON storage.objects FOR DELETE TO authenticated USING (
 bucket_id='chat-attachments' AND array_length(storage.foldername(name),1)>=3
 AND (storage.foldername(name))[3]=(SELECT auth.uid()::text)
);