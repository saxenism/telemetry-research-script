// stats-generator.js
import { Octokit } from '@octokit/rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import axios from 'axios';
import { format } from 'date-fns';
import Table from 'cli-table3';
import * as dotenv from 'dotenv';
import { writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Initialize dotenv
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Rest of the code remains the same but with ES module syntax
const GITHUB_TOKEN = 'YOUR-GITHUB-TOKEN';
// Octokit initialization
// Create RetryOctokit with plugins
const RetryOctokit = Octokit.plugin(retry, throttling);

// Initialize Octokit with plugins
const octokit = new RetryOctokit({
  auth: GITHUB_TOKEN,
  throttle: {
    onRateLimit: (retryAfter, options, octokit, retryCount) => {
      console.warn(`Rate limit hit, retrying after ${retryAfter} seconds`);
      return retryCount < 2;
    },
    onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
      console.warn(`Secondary rate limit hit, retrying after ${retryAfter} seconds`);
      return retryCount < 2;
    },
  },
});

const repositories = [
  { owner: 'getsentry', repo: 'sentry' },
  { owner: 'PostHog', repo: 'posthog' },
  { owner: 'glitchtip', repo: 'glitchtip-backend' }, // Fixed path
  { owner: 'prometheus', repo: 'prometheus' },
  { owner: 'open-telemetry', repo: 'opentelemetry-specification' },
  { owner: 'elastic', repo: 'elasticsearch' },
  { owner: 'opstrace', repo: 'opstrace' }
];

const sdks = {
  rust: [
    { owner: 'getsentry', repo: 'sentry-rust' },
    { owner: 'PostHogHQ', repo: 'posthog-rust' }, // Fixed path
    { owner: 'prometheus', repo: 'client_rust' },
    { owner: 'open-telemetry', repo: 'opentelemetry-rust' }
  ],
  node: [
    { owner: 'getsentry', repo: 'sentry-javascript' },
    { owner: 'PostHog', repo: 'posthog-node' },
    { owner: 'siimon', repo: 'prom-client' },
    { owner: 'open-telemetry', repo: 'opentelemetry-js' }
  ]
};

// Update the getRepoStats function
async function getRepoStats(owner, repo) {
  try {
    console.log(`Fetching stats for ${owner}/${repo}...`);
    
    const repoPromise = octokit.repos.get({ owner, repo });
    const commitsPromise = octokit.repos.getCommitActivityStats({ owner, repo });
    const releasesPromise = octokit.repos.listReleases({ owner, repo, per_page: 1 });
    const issuesPromise = octokit.issues.listForRepo({ owner, repo, state: 'closed', per_page: 1 });

    const [
      { data: repoData },
      { data: commitActivity },
      { data: releases },
      { data: closedIssues }
    ] = await Promise.all([repoPromise, commitsPromise, releasesPromise, issuesPromise]);

    console.log(`Successfully fetched data for ${owner}/${repo}`);

    const weeklyCommits = commitActivity?.length > 0 
      ? commitActivity[commitActivity.length - 1].total 
      : 0;

    let lastRelease = 'No releases';
    if (releases && releases[0]?.published_at) {
      const releaseDate = new Date(releases[0].published_at);
      if (!isNaN(releaseDate)) {
        lastRelease = releaseDate.toLocaleDateString();
      } else {
        lastRelease = 'Invalid Date';
      }
    }

    const stats = {
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      weeklyCommits,
      openIssues: repoData.open_issues_count || 0,
      license: repoData.license?.spdx_id || 'Unknown',
      lastRelease
    };

    console.log(`Stats for ${owner}/${repo}:`, stats);
    return stats;

  } catch (error) {
    console.error(`Error fetching stats for ${owner}/${repo}:`, {
      status: error.status,
      message: error.message,
      documentation_url: error.documentation_url
    });

    // Return default values with error indication
    return {
      stars: 'Error',
      forks: 'Error',
      weeklyCommits: 'Error',
      openIssues: 'Error',
      license: 'Error',
      lastRelease: 'Error'
    };
  }
}


async function getStackOverflowStats(tag) {
  try {
    const response = await axios.get(
      `https://api.stackexchange.com/2.3/tags/${tag}/info?site=stackoverflow`
    );
    return response.data.items[0]?.count || 0;
  } catch (error) {
    console.error(`Error fetching Stack Overflow stats for ${tag}:`, error);
    return 0;
  }
}


// Update the table creation
function createMarkdownTable(headers, rows) {
  const table = new Table({
    head: headers,
    style: {
      head: [],
      border: []
    },
    chars: {
      'top': '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      'bottom': '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      'left': '│',
      'left-mid': '├',
      'right': '│',
      'right-mid': '┤',
      'mid': '─',
      'mid-mid': '┼',
      'middle': '│'
    }
  });

  rows.forEach(row => {
    const sanitizedRow = row.map(cell => {
      if (cell === null || cell === undefined) return 'N/A';
      if (cell === 'Invalid Date') return 'No Release';
      return cell.toString();
    });
    table.push(sanitizedRow);
  });

  return table.toString();
}

async function generateReport() {
  const date = format(new Date(), 'yyyy-MM-dd');
  let report = `# GitHub Repository Statistics (${date})\n\n`;

  // Main repositories stats
  const mainRepoStats = await Promise.all(
    repositories.map(async ({ owner, repo }) => {
      const stats = await getRepoStats(owner, repo);
      return {
        name: `${owner}/${repo}`,
        stats
      };
    })
  );

  // Format main repository stats table
  const mainRepoHeaders = [
    'Project',
    'Stars',
    'Forks',
    'Weekly Commits',
    'Open Issues',
    'License',
    'Last Release'
  ];

  const mainRepoRows = mainRepoStats
    .filter(repo => repo.stats)
    .map(repo => [
      repo.name,
      repo.stats.stars.toLocaleString(),
      repo.stats.forks.toLocaleString(),
      repo.stats.weeklyCommits.toString(),
      repo.stats.openIssues.toLocaleString(),
      repo.stats.license,
      new Date(repo.stats.lastRelease).toLocaleDateString()
    ]);

  report += '## 1. Main Repository Metrics\n\n';
  report += createMarkdownTable(mainRepoHeaders, mainRepoRows);
  report += '\n\n';

  // SDK Stats
  report += '## 2. SDK Statistics\n\n';

  for (const [language, sdkList] of Object.entries(sdks)) {
    const sdkStats = await Promise.all(
      sdkList.map(async ({ owner, repo }) => {
        const stats = await getRepoStats(owner, repo);
        return {
          name: `${owner}/${repo}`,
          stats
        };
      })
    );

    report += `### ${language.toUpperCase()} SDKs\n\n`;
    
    const sdkHeaders = [
      'SDK',
      'Stars',
      'Forks',
      'Weekly Commits',
      'Last Release'
    ];

    const sdkRows = sdkStats
      .filter(sdk => sdk.stats)
      .map(sdk => [
        sdk.name,
        sdk.stats.stars.toLocaleString(),
        sdk.stats.forks.toLocaleString(),
        sdk.stats.weeklyCommits.toString(),
        new Date(sdk.stats.lastRelease).toLocaleDateString()
      ]);

    report += createMarkdownTable(sdkHeaders, sdkRows);
    report += '\n\n';
  }

  // Stack Overflow stats
  const stackOverflowStats = await Promise.all(
    ['sentry', 'posthog', 'prometheus', 'elasticsearch']
      .map(async tag => ({
        tag,
        count: await getStackOverflowStats(tag)
      }))
  );

  report += '## 3. Community Engagement Metrics\n\n';
  
  const soHeaders = ['Tag', 'Questions'];
  const soRows = stackOverflowStats.map(stat => [
    stat.tag,
    stat.count.toLocaleString()
  ]);

  report += createMarkdownTable(soHeaders, soRows);

  // Save report
  const timestamp = format(new Date(), 'HH-mm-ss');
  const fileName = `github-stats-${date}-${timestamp}.md`;
  const outputPath = join(__dirname, fileName);
  await writeFile(outputPath, report);
  console.log(`Report generated: github-stats-${date}.md`);
}

// Error handling wrapper
async function main() {
  try {
    await generateReport();
  } catch (error) {
    console.error('Error generating report:', error);
    process.exit(1);
  }
}

main();
