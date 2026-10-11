import { LegalView } from "@/components/legal-view";
import { pageMetadata } from "@/lib/metadata";
import { page } from "@content/privacy";

export const metadata = pageMetadata(page.meta, "/privacy");
export default function Privacy() {
  return <LegalView page={page} />;
}
