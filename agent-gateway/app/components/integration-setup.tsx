import { Card } from "@astryxdesign/core/Card";
import { Code } from "@astryxdesign/core/Code";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

export type EnvironmentRequirement = {
  name: string;
  purpose: string;
  requirement: "required" | "recommended" | "optional";
  configured: boolean;
  placeholder: string;
};

export type IntegrationSetupGuide = {
  title: string;
  summary: string;
  status: "ready" | "attention" | "fallback" | "not_required";
  statusLabel: string;
  variables: EnvironmentRequirement[];
  envExample: string | null;
  steps: string[];
  verify: string;
  docs: Array<{ label: string; href: string }>;
};

const GUIDE_TONE: Record<
  IntegrationSetupGuide["status"],
  "green" | "yellow" | "blue" | "gray"
> = {
  ready: "green",
  attention: "yellow",
  fallback: "blue",
  not_required: "gray",
};

function VariableStatus({ variable }: { variable: EnvironmentRequirement }) {
  if (variable.configured) {
    return <Token size="sm" color="green" label="Configured" />;
  }
  if (variable.requirement === "required") {
    return <Token size="sm" color="yellow" label="Missing" />;
  }
  return (
    <Token
      size="sm"
      color="gray"
      label={variable.requirement === "recommended" ? "Not set" : "Default"}
    />
  );
}

/**
 * Provider credentials on the page for the feature that consumes them.
 *
 * The loader supplies names and booleans only. Values never enter this prop,
 * which makes this component safe to serialise into the dashboard document
 * and safe to leave visible during a screen share.
 */
export function IntegrationSetup({ guide }: { guide: IntegrationSetupGuide }) {
  return (
    <VStack gap={4}>
      <HStack gap={3} hAlign="between" vAlign="start" wrap="wrap">
        <VStack gap={1}>
          <Heading level={3}>{guide.title}</Heading>
          <Text color="secondary">{guide.summary}</Text>
        </VStack>
        <Token
          size="md"
          color={GUIDE_TONE[guide.status]}
          label={guide.statusLabel}
        />
      </HStack>

      {guide.variables.length > 0 ? (
        <Card padding={0}>
          <List density="spacious" hasDividers>
            {guide.variables.map((variable) => (
              <ListItem
                key={variable.name}
                label={<Code>{variable.name}</Code>}
                description={variable.purpose}
                endContent={<VariableStatus variable={variable} />}
              />
            ))}
          </List>
        </Card>
      ) : (
        <Card variant="muted">
          <Text>No external provider credential is required for this feature.</Text>
        </Card>
      )}

      {guide.envExample ? (
        <CodeBlock
          code={guide.envExample}
          language="bash"
          title="Repository root .env"
          hasCopyButton
          container="card"
          size="sm"
        />
      ) : null}

      <VStack gap={2}>
        <Heading level={4}>Set it up</Heading>
        <Card>
          <List listStyle="decimal" density="spacious">
            {guide.steps.map((step, index) => (
              <ListItem key={`${index}-${step}`} label={step} />
            ))}
          </List>
        </Card>
      </VStack>

      <Card variant="muted">
        <VStack gap={2}>
          <Text>
            <Text as="span" weight="semibold">
              Verify: {" "}
            </Text>
            {guide.verify}
          </Text>
          {guide.docs.length > 0 ? (
            <HStack gap={3} wrap="wrap">
              {guide.docs.map((doc) => (
                <Link key={doc.href} href={doc.href} isExternalLink>
                  {doc.label}
                </Link>
              ))}
            </HStack>
          ) : null}
        </VStack>
      </Card>
    </VStack>
  );
}
