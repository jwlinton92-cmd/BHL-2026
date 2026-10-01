name: Update standings

on:
  schedule:
    - cron: "15 12 * * *"        # daily, 7:15am Central
  push:
    branches: [main]
    paths:
      - rosters.json
      - scoring.json
      - aliases.json
      - update.py
  workflow_dispatch: {}          # adds a "Run workflow" button in the Actions tab

permissions:
  contents: write
  pages: write          # lets the job ask GitHub Pages to republish

concurrency:
  group: update-standings
  cancel-in-progress: false

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Pull NHL stats and rescore
        run: python update.py

      - name: Commit updated data
        id: commit
        run: |
          git config user.name  "bhl-bot"
          git config user.email "bhl-bot@users.noreply.github.com"
          git add standings.json players.json
          if git diff --cached --quiet; then
            echo "No changes to commit."
          else
            git commit -m "Update standings $(date -u +'%Y-%m-%d %H:%M UTC')"
            git pull --rebase origin main
            git push
            echo "pushed=true" >> "$GITHUB_OUTPUT"
          fi

      # Commits made by this job don't reliably trigger a Pages rebuild on
      # their own, so request one explicitly whenever new data was pushed.
      - name: Republish the site
        if: steps.commit.outputs.pushed == 'true'
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh api -X POST "repos/${{ github.repository }}/pages/builds" || echo "Could not request a Pages build; it may still rebuild on its own."
