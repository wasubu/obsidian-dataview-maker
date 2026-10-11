# Obsidian Sample Plugin


## Rename this plugin?
It might be a good idea to call this plugin. advanceDB

## I would like to add these
1. **db.selectPrompt(title, options[], callback)**  
Description: Spawns a quick modal dropdown list allowing the user to select one option from a list (e.g., picking a project category, status, or priority) and triggers a callback with their choice.
2. **db.addTag(fileOrPath, tag)**  
Description: Programmatically adds a tag (like #completed, #urgent, or #book) directly to any markdown note's frontmatter or inline cache without manual editing.
3. **db.toggleFullscreen(selector)**  
Description: Instantly expands your dashboard container or canvas into full screen mode (and back), giving your games or dashboards an immersive native app feel.
4. **db.searchVaultText(keyword)**  
Description: Performs a full-text search across the body content of all markdown files in your vault, returning matching file paths, names, and text snippets.
5. **db.markdownToHtml(markdownText, targetEl)**  
Description: Renders real Obsidian markdown (including wikilinks, callouts, bold text, and formatting) directly inside any DOM element in your custom UI.
6. **db.prompt(title, placeholder, callback)**  
Description: Spawns a lightweight single-input popup modal to quickly gather text input from the user (such as renaming an item or adding a quick note) and passes it to a callback.
7. **db.getFrontmatter(path)**  
Description: Fetches the entire frontmatter metadata dictionary for a specific vault note instantly by its file path.
8. **db.deleteNote(path)**  
Description: Safely moves a specified markdown note to the Obsidian vault trash folder.
9. **db.noteExists(path)**  
Description: Checks whether a markdown note or folder already exists at a given file path in your vault.
10. **db.getAllTags()**  
Description: Returns an array of all unique tags currently used across your entire Obsidian vault metadata cache.
11. **db.throttle(fn, limitMs)**  
Description: Limits how frequently a function can fire (e.g., preventing lag during rapid window resizing or canvas dragging).
12. **db.getBacklinks(path)**  
Description: Scans your vault metadata cache and returns an array of file paths and names that link directly to the specified target note.
13. **db.download(filename, content, type)**  
Description: Triggers a browser file download prompt to export dashboard data, JSON logs, or generated notes directly to the user's local machine.
14. **db.relativeTime(date)**  
Description: Converts any timestamp, Date object, or ISO string into a human-readable relative time format (e.g., "3 hours ago" or "yesterday").
15. **db.collection(path, fallback)**  
Description: Automatically queries a specified vault folder (e.g., "Books"), normalizes the frontmatter and metadata properties into a clean array of objects, and gracefully falls back to your sample data if the vault folder is empty or if the code is running in a preview/browser environment. const books = await db.collection("Books", [ { title: "Atomic Habits", author: "James Clear", status: "Reading" } ]);
16. **db.resolveAsset(path)**  
Description: Converts a relative Obsidian vault asset path (like Attachments/cover.jpg) into a browser-safe, renderable resource URL via Obsidian's internal adapter (app.vault.adapter.getResourcePath).
17. **db.confirm(title, message, onConfirm)**  
Description: Spawns a native-themed confirmation modal dialog featuring custom title/message text, alongside "Cancel" and "Confirm" action buttons.
18. **db.renameNote(oldPath, newPath)**  
Description: Safely renames or moves a markdown note to a new file path in your vault, preserving its contents and metadata.
19. **db.getFolders()**  
Description: Returns an array of all unique folder paths in your vault, which is perfect for dynamically populating folder selectors or category dropdowns in your dashboards.
20. **db.getRandomNote(folder)**  
Description: Returns an array of all unique folder paths in your vault, which is perfect for dynamically populating folder selectors or category dropdowns in your dashboards.
21. **db.getThemeColor(cssVar)**  
Description: Instantly fetches the computed value of any Obsidian CSS theme variable (like --text-normal, --interactive-accent, or --background-secondary) so your custom UI widgets match the user's active light/dark theme automatically.
22. **db.openSplit(path, direction)**  
Description: Opens a specified vault note in a split workspace pane (horizontal or vertical) right next to your active dashboard view.
23. **db.getOutgoingLinks(path)**  
Description: Scans the metadata cache of a specific note and returns an array of all files or external links that the note points to.
24. **db.isDarkMode()**  
Description: Returns a boolean indicating whether the Obsidian vault is currently running a dark theme, allowing your custom UI components to adapt their color palettes instantly.
25. **db.onActiveLeafChange(callback)**  
Description: Listens for when the user switches active notes in the Obsidian workspace, automatically triggering your callback function with the newly active file's path and name.










