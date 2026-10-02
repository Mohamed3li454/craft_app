import React from 'react';
import { render, screen } from '@testing-library/react';
import { ReasoningBanner } from '../src/components/ui/reasoning-banner';
import { StatusPill } from '../src/components/ui/status-pill';
import { DataTable } from '../src/components/ui/data-table';

describe('UI Safety & Core Components', () => {
  test('ReasoningBanner renders explicit chain-of-thought redaction invariant notice', () => {
    render(<ReasoningBanner />);
    expect(screen.getByText(/Internal Chain-of-Thought Redacted/i)).toBeInTheDocument();
    expect(screen.getByText(/Per platform security and privacy invariants/i)).toBeInTheDocument();
  });

  test('StatusPill correctly normalizes and renders status text', () => {
    const { rerender } = render(<StatusPill status="HEALTHY" />);
    expect(screen.getByText('healthy')).toBeInTheDocument();

    rerender(<StatusPill status="DELIVERED" />);
    expect(screen.getByText('delivered')).toBeInTheDocument();

    rerender(<StatusPill status="FAILED" />);
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  test('DataTable renders data rows and headers properly', () => {
    const columns = [
      { header: 'ID', accessorKey: 'id' as const },
      { header: 'Name', accessorKey: 'name' as const },
    ];
    const data = [
      { id: '1', name: 'Alpha' },
      { id: '2', name: 'Beta' },
    ];

    render(<DataTable columns={columns} data={data} />);

    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  test('DataTable renders empty state message when data is empty', () => {
    const columns = [{ header: 'ID', accessorKey: 'id' as const }];
    render(<DataTable columns={columns} data={[]} emptyMessage="Custom empty list message" />);

    expect(screen.getByText('Custom empty list message')).toBeInTheDocument();
  });
});
