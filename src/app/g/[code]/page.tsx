import GroupApp from "@/components/GroupApp";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <GroupApp code={code.toUpperCase()} />;
}
