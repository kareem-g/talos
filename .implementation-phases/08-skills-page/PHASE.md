# Phase 08: Skills Page

> **Goal**: A complete skills management system — import skills from the internet, browse available ones, and control which skills are active per workspace.

---

## What to Build

A full-screen Skills page (not a sidebar tab — it's a main view, like Settings) that serves as the skill marketplace and management center.

### The Concept

Skills are reusable agent capabilities — prompt templates, tool configurations, workflow definitions. Think of them as plugins that teach your agents new tricks. You import them from the internet, install them, and toggle them on/off per workspace.

### The View: Three Tabs

#### 1. Browse Tab

A searchable, filterable grid of available skills:

- **Search bar** at the top — search by name, description, or tag
- **Category filters** — Development, Testing, DevOps, Writing, Research, etc.
- **Skill cards** in a grid layout, each showing:
  - Skill name
  - Short description (1-2 lines)
  - Author/source
  - Version
  - Install count (popularity)
  - "Install" button (or "Installed ✓" if already installed)
- **Featured section** at the top — curated picks
- **Import from URL** button — opens a dialog to paste a GitHub repo URL or raw skill URL

#### 2. Installed Tab

A list of skills you've installed:

- Skill name + description
- Version + update availability
- Enable/disable global toggle
- "Configure" button for skills that have settings
- "Uninstall" button
- Last updated date

#### 3. Workspaces Tab

A matrix view of workspaces × skills:

- Rows = workspaces (projects)
- Columns = installed skills
- Each cell has a toggle — enable/disable that skill for that workspace
- "Enable all" / "Disable all" per row and per column
- Search/filter to find a specific workspace or skill

### Skill Format

A skill is a directory or file containing:
- A manifest (name, description, version, author, tags)
- The skill content (prompt template, tool definitions, workflow steps)
- Optional configuration schema (what settings the user can tweak)

### Import Flow

1. User clicks "Import from URL"
2. Dialog appears with a URL field
3. User pastes a GitHub repo URL, a raw file URL, or a registry URL
4. AgentDeck fetches and validates the skill
5. Shows a preview: name, description, what it does
6. User confirms → skill is installed
7. Success notification

### Built-in Browser

The Browse tab includes a built-in browser panel (reuse the Browser View from Phase 04) so you can visit skill registry websites, browse available skills, and import them without leaving AgentDeck.

### Backend Support Needed

- Skill storage in SQLite (manifest + content)
- Import from URL (fetch, validate, store)
- Registry API integration (fetch available skills from a curated source)
- Per-workspace skill assignment
- Skill versioning and updates

### Empty State (Browse)

"Browse hundreds of skills to supercharge your agents — search above or import from a URL."

### Empty State (Installed)

"No skills installed yet — browse the marketplace or import from a URL to get started."

---

## Acceptance Criteria

- [ ] Browse tab with searchable, filterable skill grid
- [ ] Skill cards show name, description, author, version, install button
- [ ] Import from URL dialog with validation and preview
- [ ] Installed tab with enable/disable and uninstall
- [ ] Workspaces tab with matrix toggle view
- [ ] Backend stores skills in SQLite
- [ ] Import fetches and validates skill from URL
- [ ] Per-workspace skill activation works
- [ ] Built-in browser panel for discovering skills online
