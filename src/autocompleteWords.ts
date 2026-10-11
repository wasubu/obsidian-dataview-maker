// autocompleteWords.ts
export default {
  "tokenWeights": {
    "const": 95, "console": 90, "let": 85, "function": 85, "return": 80,
    "async": 75, "await": 75, "if": 75, "else": 75, "for": 70, "while": 70,
    "db": 95, "$": 90, "$$": 85, "dv": 85, "app": 90, "container": 90,
    "log()": 95, "query()": 95, "createNote()": 90, "updateNote()": 90, "renderList()": 90, 
    "bindFilter()": 85, "openNote()": 85, "increment()": 85, "toggleProp()": 85, "modal()": 85,
    "state()": 85, "timer()": 80, "loop()": 80, "canvas()": 80, "storage()": 80, "notify()": 85,
    "div": 100, "span": 90, "button": 90, "input": 85, "img": 85, "a": 80, "p": 80,
    "class": 95, "id": 90, "src": 85, "href": 85, "onclick": 80,
    "display": 100, "flex": 95, "grid": 90, "color": 90, "background": 90, "padding": 85, "margin": 85
  },
  "voidTags": [
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"
  ],
  "jsTopLevel": [
    "const", "let", "var", "function", "return", "if", "else", "for", "while", 
    "async", "await", "new", "class", "switch", "case", "break", "try", "catch", 
    "finally", "throw", "typeof", "instanceof", "true", "false", "null", "undefined", 
    "this", "window", "document", "console", "db", "dv", "app", "container", "$", "$$", 
    "Math", "JSON", "Promise", "Array", "Object", "String", "Number", "Boolean", 
    "Date", "Map", "Set", "RegExp", "Error", "setTimeout", "setInterval", 
    "clearTimeout", "clearInterval", "localStorage", "sessionStorage", "fetch", 
    "alert", "confirm", "prompt", "parseInt", "parseFloat", "isNaN", "isFinite"
  ],
  "commonMethods": [
    "map()", "filter()", "forEach()", "find()", "includes()", "slice()", "join()", 
    "length", "push()", "pop()", "shift()", "unshift()", "reduce()", "some()", 
    "every()", "sort()", "reverse()", "indexOf()", "lastIndexOf()", "split()", 
    "trim()", "replace()", "replaceAll()", "toLowerCase()", "toUpperCase()", 
    "substring()", "substr()", "charAt()", "startsWith()", "endsWith()", "keys()", 
    "values()", "entries()", "hasOwnProperty()", "assign()"
  ],
  "objectCompletions": {
    "console": [
      "log()", "warn()", "error()", "info()", "table()", "clear()", 
      "time()", "timeEnd()", "group()", "groupEnd()", "assert()"
    ],
    "db": [
      "query()", "createNote()", "updateNote()", "increment()", "toggleProp()", 
      "renderList()", "bindFilter()", "openNote()", "modal()", "state()", 
      "timer()", "loop()", "canvas()", "onKey()", "beep()", "storage()", 
      "drag()", "notify()", "onVaultChange()", "onCleanup()"
    ],
    "app": [
      "vault", "workspace", "metadataCache", "fileManager", "plugins", "setting"
    ],
    "vault": [
      "getMarkdownFiles()", "getFiles()", "getAllLoadedFiles()", "getAbstractFileByPath()", 
      "create()", "createFolder()", "append()", "modify()", "delete()", "trash()", 
      "read()", "cachedRead()", "rename()"
    ],
    "workspace": [
      "openLinkText()", "getLeaf()", "getLeavesOfType()", "setActiveLeaf()", 
      "revealLeaf()", "getActiveFile()", "on()", "off()"
    ],
    "Math": [
      "abs()", "ceil()", "floor()", "round()", "max()", "min()", "pow()", 
      "sqrt()", "random()", "sin()", "cos()", "tan()", "PI", "E"
    ],
    "JSON": [
      "parse()", "stringify()"
    ],
    "localStorage": [
      "getItem()", "setItem()", "removeItem()", "clear()", "key()"
    ],
    "document": [
      "querySelector()", "querySelectorAll()", "getElementById()", 
      "getElementsByClassName()", "createElement()", "createTextNode()", 
      "body", "head", "title", "cookie"
    ],
    "window": [
      "innerWidth", "innerHeight", "devicePixelRatio", "requestAnimationFrame()", 
      "cancelAnimationFrame()", "setTimeout()", "setInterval()", "clearTimeout()", 
      "clearInterval()", "alert()", "confirm()", "prompt()"
    ]
  }
};