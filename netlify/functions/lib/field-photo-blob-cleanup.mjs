const DELETE_BATCH_SIZE = 25;

function deletionTasks(files) {
  return files.flatMap((file) => [
    ...(file.inbox_blob_key
      ? [{ fileId: file.id, column: 'inbox_blob_key', key: file.inbox_blob_key }]
      : []),
    ...(file.thumbnail_blob_key
      ? [{ fileId: file.id, column: 'thumbnail_blob_key', key: file.thumbnail_blob_key }]
      : []),
  ]);
}

async function clearDeletedKey(db, deletion) {
  if (deletion.column === 'inbox_blob_key') {
    await db.sql`
      UPDATE field_photo_submission_files
      SET inbox_blob_key = NULL, updated_at = NOW()
      WHERE id = ${deletion.fileId} AND inbox_blob_key = ${deletion.key}
    `;
    return;
  }

  await db.sql`
    UPDATE field_photo_submission_files
    SET thumbnail_blob_key = NULL, updated_at = NOW()
    WHERE id = ${deletion.fileId} AND thumbnail_blob_key = ${deletion.key}
  `;
}

// Blob deletion and key clearing form a recoverable two-step operation. A key
// stays in the database when deletion fails so a later scheduled run can retry.
export async function deletePrivatePhotoBlobs(db, store, files) {
  const deletions = deletionTasks(files);
  for (let index = 0; index < deletions.length; index += DELETE_BATCH_SIZE) {
    const batch = deletions.slice(index, index + DELETE_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((deletion) => store.delete(deletion.key)));
    const succeeded = batch.filter((_, resultIndex) => results[resultIndex].status === 'fulfilled');
    await Promise.all(succeeded.map((deletion) => clearDeletedKey(db, deletion)));
  }
}
