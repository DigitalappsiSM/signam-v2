/** Minimal transactional Firestore double; fixtures contain no enterprise data. */
export function fakeFirestore(
  initial: Record<string, Record<string, unknown>> = {},
) {
  const documents = new Map(Object.entries(initial));
  let serial = Promise.resolve();
  const apply = (
    path: string,
    value: Record<string, unknown>,
    merge = false,
  ) => {
    const next = { ...(merge ? documents.get(path) : {}), ...value };
    for (const key of Object.keys(next))
      if (next[key] === DELETE_FIELD) delete next[key];
    documents.set(path, next);
  };
  const ref = (path: string) => ({
    path,
    id: path.split('/').at(-1)!,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => snapshot(path),
    set: async (
      value: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => apply(path, value, options?.merge),
    update: async (value: Record<string, unknown>) => apply(path, value, true),
  });
  const snapshot = (path: string) => {
    const data = documents.get(path);
    return {
      id: path.split('/').at(-1)!,
      exists: !!data,
      ref: ref(path),
      get: (key: string) => data?.[key],
      data: () => data,
    };
  };
  const collection = (
    path: string,
    filters: Array<[string, unknown]> = [],
  ) => ({
    doc: (id = 'generated') => ref(`${path}/${id}`),
    where: (key: string, _op: string, value: unknown) =>
      collection(path, [...filters, [key, value]]),
    get: async () => ({
      docs: [...documents.keys()]
        .filter(
          (key) =>
            key.startsWith(`${path}/`) &&
            !key.slice(path.length + 1).includes('/'),
        )
        .filter((key) =>
          filters.every(
            ([field, value]) => documents.get(key)?.[field] === value,
          ),
        )
        .map(snapshot),
    }),
  });
  const transaction = {
    get: async (reference: { path: string }) => snapshot(reference.path),
    getAll: async (...references: Array<{ path: string }>) =>
      references.map((item) => snapshot(item.path)),
    set: (
      reference: { path: string },
      value: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => apply(reference.path, value, options?.merge),
    update: (reference: { path: string }, value: Record<string, unknown>) =>
      apply(reference.path, value, true),
    delete: (reference: { path: string }) => documents.delete(reference.path),
  };
  return {
    documents,
    collection,
    getAll: transaction.getAll,
    runTransaction: <T>(
      run: (value: typeof transaction) => Promise<T>,
    ): Promise<T> => {
      const result = serial.then(() => run(transaction));
      serial = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
export const DELETE_FIELD = '__delete_field__';
