export async function deleteBlobKeys(store, keys, batchSize = 25) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const deleted = new Set();

  for (let index = 0; index < uniqueKeys.length; index += batchSize) {
    const batch = uniqueKeys.slice(index, index + batchSize);
    const results = await Promise.allSettled(batch.map((key) => store.delete(key)));
    results.forEach((result, resultIndex) => {
      if (result.status === 'fulfilled') deleted.add(batch[resultIndex]);
    });
  }

  return deleted;
}
