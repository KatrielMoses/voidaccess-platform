import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@voidaccess/ui";

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-3">{children}</CardContent>
    </Card>
  );
}
