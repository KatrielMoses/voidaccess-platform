import { redirect } from "next/navigation";

export default async function ResultsIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/investigations/${id}/results/summary`);
}
