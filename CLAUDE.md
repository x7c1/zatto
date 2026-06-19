# Claude AI Guidelines

## Documentation

**DRY Principle**: Write each piece of information in ONE place only. Never duplicate content across files.

## Language

This repository is published as OSS. Documentation, code comments, commit messages, and pull request descriptions are written in English by default. Do not include links or references to private/internal repositories.

## Code Quality

After making code changes, always run:

```bash
npm run build && npm run check && npm run test:run
```

Fix any issues before considering the task complete.
