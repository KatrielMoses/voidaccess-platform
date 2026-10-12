import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@voidaccess/ui";
import { PROFILE_ROLES, PROFILE_USE_CASES } from "@/content/examples";
import { saveProfileAction, skipProfileAction } from "./actions";

const selectCls =
  "h-10 w-full rounded-md border border-border-subtle bg-surface px-3 text-sm text-fg hover:border-border-strong focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent-border";

/** Optional and skippable: "Skip" records that we asked and stops asking. */
export function ProfileCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Two quick questions (optional)</CardTitle>
        <CardDescription>It helps us decide what to build next. Skip if you prefer.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={saveProfileAction} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="role" className="text-sm font-medium">
                Your role
              </label>
              <select id="role" name="role" defaultValue="" className={selectCls}>
                <option value="">Choose one</option>
                {PROFILE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="use_case" className="text-sm font-medium">
                Main use
              </label>
              <select id="use_case" name="use_case" defaultValue="" className={selectCls}>
                <option value="">Choose one</option>
                {PROFILE_USE_CASES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              Save
            </Button>
            <Button type="submit" variant="ghost" formAction={skipProfileAction} formNoValidate>
              Skip
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
