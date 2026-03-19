import React, { useEffect, useMemo, useState } from 'react';

type NoteFolder = {
  id: string;
  name: string;
};

type NoteEntry = {
  id: string;
  title: string;
  content: string;
  folderId: string;
  createdAt: number;
  updatedAt: number;
};

type NotesState = {
  folders: NoteFolder[];
  notes: NoteEntry[];
  selectedFolderId: string;
  selectedNoteId: string | null;
};

const STORAGE_KEY = 'ttrpg.notes.v1';
const DEFAULT_FOLDER_ID = 'default';
const ALL_FOLDERS_ID = '__all__';

function makeId(prefix: string) {
  const g = globalThis as any;
  if (g?.crypto?.randomUUID) return `${prefix}-${g.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function collectWikiLinks(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(content)) !== null) {
    const title = (m[1] || '').trim();
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

function buildInitialState(): NotesState {
  const now = Date.now();
  const welcomeId = makeId('note');
  return {
    folders: [{ id: DEFAULT_FOLDER_ID, name: 'General' }],
    notes: [
      {
        id: welcomeId,
        title: 'Welcome',
        content: 'Use [[Welcome]] links to jump between notes.',
        folderId: DEFAULT_FOLDER_ID,
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedFolderId: DEFAULT_FOLDER_ID,
    selectedNoteId: welcomeId,
  };
}

function loadState(): NotesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildInitialState();
    const parsed = JSON.parse(raw) as Partial<NotesState>;
    const folders = Array.isArray(parsed.folders) ? parsed.folders : [];
    const notes = Array.isArray(parsed.notes) ? parsed.notes : [];
    if (!folders.length) return buildInitialState();
    const selectedFolderId =
      typeof parsed.selectedFolderId === 'string' ? parsed.selectedFolderId : folders[0].id;
    const selectedNoteId = typeof parsed.selectedNoteId === 'string' ? parsed.selectedNoteId : null;
    return { folders, notes, selectedFolderId, selectedNoteId };
  } catch {
    return buildInitialState();
  }
}

export function NotesTab() {
  const [state, setState] = useState<NotesState>(() => loadState());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  const notesByFolder = useMemo(() => {
    const sorted = [...state.notes].sort((a, b) => b.updatedAt - a.updatedAt);
    if (state.selectedFolderId === ALL_FOLDERS_ID) return sorted;
    return sorted.filter((n) => n.folderId === state.selectedFolderId);
  }, [state.notes, state.selectedFolderId]);

  const selectedNote = useMemo(
    () => state.notes.find((n) => n.id === state.selectedNoteId) || null,
    [state.notes, state.selectedNoteId]
  );

  const noteTitleLookup = useMemo(() => {
    const map = new Map<string, NoteEntry>();
    for (const note of state.notes) map.set(note.title.trim().toLowerCase(), note);
    return map;
  }, [state.notes]);

  const wikiLinks = useMemo(
    () => (selectedNote ? collectWikiLinks(selectedNote.content) : []),
    [selectedNote]
  );

  function selectNote(noteId: string) {
    setState((prev) => ({ ...prev, selectedNoteId: noteId }));
  }

  function createFolder() {
    const raw = prompt('Folder name');
    if (raw == null) return;
    const name = raw.trim();
    if (!name) return;
    setState((prev) => {
      const id = makeId('folder');
      return {
        ...prev,
        folders: [...prev.folders, { id, name }],
        selectedFolderId: id,
      };
    });
  }

  function createNote() {
    setState((prev) => {
      const now = Date.now();
      const id = makeId('note');
      const folderId =
        prev.selectedFolderId === ALL_FOLDERS_ID ? (prev.folders[0]?.id || DEFAULT_FOLDER_ID) : prev.selectedFolderId;
      const note: NoteEntry = {
        id,
        title: 'Untitled Note',
        content: '',
        folderId,
        createdAt: now,
        updatedAt: now,
      };
      return {
        ...prev,
        notes: [note, ...prev.notes],
        selectedNoteId: id,
      };
    });
  }

  function updateSelectedNote(changes: Partial<Pick<NoteEntry, 'title' | 'content' | 'folderId'>>) {
    if (!selectedNote) return;
    setState((prev) => ({
      ...prev,
      notes: prev.notes.map((note) =>
        note.id === selectedNote.id ? { ...note, ...changes, updatedAt: Date.now() } : note
      ),
    }));
  }

  function deleteSelectedNote() {
    if (!selectedNote) return;
    if (!confirm(`Delete note "${selectedNote.title}"?`)) return;
    setState((prev) => {
      const notes = prev.notes.filter((n) => n.id !== selectedNote.id);
      const nextSelected = notes[0]?.id || null;
      return { ...prev, notes, selectedNoteId: nextSelected };
    });
  }

  function insertNoteLink() {
    if (!selectedNote) return;
    const raw = prompt('Link to note title (creates [[Title]])');
    if (raw == null) return;
    const title = raw.trim();
    if (!title) return;
    const suffix = selectedNote.content && !selectedNote.content.endsWith('\n') ? '\n' : '';
    updateSelectedNote({ content: `${selectedNote.content}${suffix}[[${title}]]` });
  }

  function openLinkedNote(linkTitle: string) {
    const match = noteTitleLookup.get(linkTitle.trim().toLowerCase());
    if (!match) return;
    setState((prev) => ({
      ...prev,
      selectedFolderId: match.folderId,
      selectedNoteId: match.id,
    }));
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 12, height: 'calc(100vh - 140px)' }}>
      <section className="panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <h2>Notes</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button onClick={createNote}>+ Note</button>
          <button onClick={createFolder}>+ Folder</button>
        </div>

        <div style={{ marginBottom: 8, fontSize: '0.85em' }} className="dim">Folders</div>
        <div style={{ display: 'grid', gap: 4, marginBottom: 10 }}>
          <button
            className={state.selectedFolderId === ALL_FOLDERS_ID ? 'active' : ''}
            onClick={() => setState((prev) => ({ ...prev, selectedFolderId: ALL_FOLDERS_ID }))}
          >
            All Notes ({state.notes.length})
          </button>
          {state.folders.map((folder) => {
            const count = state.notes.filter((n) => n.folderId === folder.id).length;
            return (
              <button
                key={folder.id}
                className={state.selectedFolderId === folder.id ? 'active' : ''}
                onClick={() => setState((prev) => ({ ...prev, selectedFolderId: folder.id }))}
                style={{ textAlign: 'left' }}
              >
                {folder.name} ({count})
              </button>
            );
          })}
        </div>

        <div style={{ marginBottom: 8, fontSize: '0.85em' }} className="dim">Notes</div>
        <div style={{ display: 'grid', gap: 4, overflow: 'auto' }}>
          {notesByFolder.map((note) => (
            <button
              key={note.id}
              className={state.selectedNoteId === note.id ? 'active' : ''}
              onClick={() => selectNote(note.id)}
              style={{ textAlign: 'left' }}
              title={new Date(note.updatedAt).toLocaleString()}
            >
              {note.title || 'Untitled Note'}
            </button>
          ))}
          {notesByFolder.length === 0 && <div className="dim">No notes in this folder.</div>}
        </div>
      </section>

      <section className="panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!selectedNote && <div className="dim">Create a note to start writing.</div>}
        {selectedNote && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px auto auto', gap: 8, alignItems: 'center' }}>
              <input
                value={selectedNote.title}
                onChange={(e) => updateSelectedNote({ title: e.target.value })}
                placeholder="Note title"
              />
              <select
                value={selectedNote.folderId}
                onChange={(e) => updateSelectedNote({ folderId: e.target.value })}
              >
                {state.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
              <button onClick={insertNoteLink}>Insert Link</button>
              <button onClick={deleteSelectedNote}>Delete</button>
            </div>

            <textarea
              value={selectedNote.content}
              onChange={(e) => updateSelectedNote({ content: e.target.value })}
              style={{ flex: 1, minHeight: 240, resize: 'vertical' }}
              placeholder="Write your note here. Use [[Another Note]] to link notes."
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 140 }}>
              <div style={{ border: '1px solid #3a3a3a', borderRadius: 6, padding: 8, overflow: 'auto' }}>
                <div className="dim" style={{ marginBottom: 6 }}>Links in this note</div>
                {wikiLinks.length === 0 && <div className="dim">No links yet.</div>}
                {wikiLinks.map((title) => {
                  const exists = noteTitleLookup.has(title.toLowerCase());
                  return (
                    <button
                      key={title}
                      onClick={() => openLinkedNote(title)}
                      disabled={!exists}
                      style={{ display: 'block', textAlign: 'left', width: '100%', marginBottom: 4 }}
                    >
                      {title}{exists ? '' : ' (missing)'}
                    </button>
                  );
                })}
              </div>
              <div style={{ border: '1px solid #3a3a3a', borderRadius: 6, padding: 8, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                <div className="dim" style={{ marginBottom: 6 }}>Preview</div>
                {selectedNote.content.split(/(\[\[[^\]]+\]\])/g).map((chunk, idx) => {
                  const m = chunk.match(/^\[\[([^\]]+)\]\]$/);
                  if (!m) return <span key={`${idx}-${chunk}`}>{chunk}</span>;
                  const linkTitle = m[1].trim();
                  const exists = noteTitleLookup.has(linkTitle.toLowerCase());
                  return (
                    <button
                      key={`${idx}-${linkTitle}`}
                      onClick={() => openLinkedNote(linkTitle)}
                      disabled={!exists}
                      className="mini"
                      style={{ margin: '0 2px' }}
                    >
                      {linkTitle}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

