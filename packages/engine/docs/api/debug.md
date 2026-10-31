# engine.debug — debug(opts?: { open?: boolean })

F3 debug panel (debug() module)


## Methods and properties
- `debug.startBench(seconds?: number)` — Start the stress test (seconds, default 20): the character auto-runs fast, continuously loading new chunks, and a report is shown in the panel at the end
- Properties:
  - `benchmarking: boolean` Stress test running (player auto-runs fast)
  - `el: HTMLElement` Panel root element
