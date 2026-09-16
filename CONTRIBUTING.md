# Team Workflow

Every developer should work from their own clone of this repository. Do not copy or share the same working folder between laptops.

## First-time setup

```powershell
git clone https://github.com/Abhishek-KumarJha/Legal-Metrology-Compliance-Checking-System.git
cd Legal-Metrology-Compliance-Checking-System
npm install
npm install --prefix client
npm install --prefix server
```

## Start work

Always update the local project before editing:

```powershell
git checkout master
git pull origin master
git checkout -b your-feature-name
```

Use a separate branch for each feature or fix. Keep commits focused and do not commit `node_modules`, build output, secrets, or local uploads.

## Save and share changes

```powershell
git status
git diff
git add .
git commit -m "Describe the change"
git push -u origin your-feature-name
```

Open a Pull Request on GitHub from `your-feature-name` into `master`. After the Pull Request is merged, update another laptop with:

```powershell
git checkout master
git pull origin master
```

## Useful commands

Run the application:

```powershell
npm run dev
```

Run checks before opening a Pull Request:

```powershell
npm test
npm run build
```

## Resolving a conflict

If Git reports a merge conflict, do not delete another developer's work. Open the marked files, keep the intended combined result, then run:

```powershell
git add .
git commit -m "Resolve merge conflict"
git push
```

The JSON files under `server/data/` are local development persistence. They are not a shared database between laptops. For shared live data, use a common database such as PostgreSQL or Supabase.