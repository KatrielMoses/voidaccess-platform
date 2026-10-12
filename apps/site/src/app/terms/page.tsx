import { LegalView } from "@/components/legal-view";
import { pageMetadata } from "@/lib/metadata";
import { page } from "@content/terms";

export const metadata = pageMetadata(page.meta, "/terms");
export default function Terms() {
  return <LegalView page={page} />;
}
