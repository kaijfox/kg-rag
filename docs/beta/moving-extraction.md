# Running extraction on another machine

Extracting facts takes one model call per passage. On a laptop that is about half a minute per passage, so a few hundred
passages take hours. If you have a machine that runs local models faster, run the extraction there and bring the results to
the machine where your agent works. Nothing needs a server or synchronisation: the results are saved as a file.

## How it works

Every model call is saved in the database's `cache.sqlite`, keyed by a hash of the model name, the prompt and the passage.
`./kg rebuild` and `./kg ingest` look in that cache before calling a model, so a machine that holds the cache entries makes
no model call at all. In the author's test, rebuilding a 39-passage document from the cache took 4.9 seconds instead of 1,122.

## Steps

On the fast machine, create the database, add the same sources, and ingest:

```sh
./kg init --db ~/kg/myproject
./kg add ~/papers --db ~/kg/myproject
./kg ingest --db ~/kg/myproject
./kg cache export /tmp/myproject-cache.sqlite --db ~/kg/myproject
```

Copy `myproject-cache.sqlite` to the other machine (a file copy, a USB drive, or any file sync). There, with the same
sources added, import the cache and ingest with `--cache-only`:

```sh
./kg init --db ~/kg/myproject
./kg add ~/papers --db ~/kg/myproject
./kg cache import /tmp/myproject-cache.sqlite --db ~/kg/myproject
./kg ingest --db ~/kg/myproject --cache-only
```

`--cache-only` is the safeguard. If any passage has no saved result, the command stops and says so, instead of quietly
starting hours of extraction on the slow machine. `./kg status` then shows `model calls 0 made, N from the cache`.

When you add documents later, repeat the cycle: ingest on the fast machine, export, import. Passages that did not change keep
their saved results, so only new passages cost model time.

## What has to match

A saved result is found only when the request is identical. Both machines therefore need:

- the same extraction model, named the same way (`qwen3.5:latest` in `kg.json`, under `llm.model`);
- the same version of kg, because the extraction prompt is part of the request (`./kg version`);
- the same passages. The same files, parsed the same way, give the same passages. A PDF parsed by a different docling
  version gives different text. For PDFs, copy the database's `artifacts/` folder (the parsed copies) to the other machine
  too, which then needs no docling of its own.

When something does not match you see the `--cache-only` stop above, naming the model and the kind of request. The fix is
to make the two settings equal, or to run without `--cache-only` and accept the wait.

## If the other machine cannot run the model at all

That is fine with `--cache-only`. The embedding model (`embeddinggemma`) is small, and the machine needs it to embed your
queries. `./kg doctor` warns that the extraction model is missing, which you can ignore when you only replay.
