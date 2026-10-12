import { LegalView } from "@/components/legal-view";
import { pageMetadata } from "@/lib/metadata";
import { page } from "@content/acceptable-use";

export const metadata = pageMetadata(page.meta, "/acceptable-use");
export default function AcceptableUse() {
  return <LegalView page={page} />;
}
