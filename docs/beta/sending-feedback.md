# Sending feedback

You do not need to read any logs. The system records every search, what each step considered, and the reports your agent
made. Two commands turn that into something to send.

## See a summary yourself

```sh
./kg report --db ~/kg/myproject
```

It lists the number of searches, how your agent rated them, the searches that went badly, and how the machine you use
compared with the plain search that ran beside it.

## Send an export

```sh
./kg export --db ~/kg/myproject
```

This writes a folder (`kg-export-<date>`) with the history, the configuration and a copy of the index. Zip it and send it. It
contains the text of your documents, because the index does. If your corpus is private, run `./kg export --no-text`, which
leaves out the index and with it every passage of your documents. Queries, your agent's notes and the names of your source
files remain in the history, so look at the output of `./kg report` first if that matters.

You can also run `./kg serve viewer --db ~/kg/myproject` and open `http://127.0.0.1:4319/` to see each search step by step.
