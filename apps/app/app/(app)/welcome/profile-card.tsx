import { Button, NativeSelect } from "@voidaccess/ui";
import { PROFILE_ROLES, PROFILE_USE_CASES } from "@/content/examples";
import { Row } from "@/components/page-header";
import { saveProfileAction, skipProfileAction } from "./actions";

/** Optional and skippable: "Skip" records that we asked and stops asking. */
export function ProfileCard() {
  return (
    <Row
      title="Two quick questions (optional)"
      note="It helps us decide what to build next. Skip if you prefer."
    >
      <form action={saveProfileAction} className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="role" className="text-[15px] text-dim">
              Your role
            </label>
            <NativeSelect id="role" name="role" defaultValue="">
              <option value="">Choose one</option>
              {PROFILE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="use_case" className="text-[15px] text-dim">
              Main use
            </label>
            <NativeSelect id="use_case" name="use_case" defaultValue="">
              <option value="">Choose one</option>
              {PROFILE_USE_CASES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="flex gap-2.5">
          <Button type="submit" variant="secondary">
            Save
          </Button>
          <Button type="submit" variant="ghost" formAction={skipProfileAction} formNoValidate>
            Skip
          </Button>
        </div>
      </form>
    </Row>
  );
}
