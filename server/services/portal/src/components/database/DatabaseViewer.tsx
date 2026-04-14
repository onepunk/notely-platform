/**
 * Database Viewer Component
 * Browse and manage database tables and records (Mantis theme style)
 */

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  Box,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  InputAdornment,
  IconButton,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Stack,
  Tooltip,
  useTheme,
} from '@mui/material';
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Download as DownloadIcon,
  DeleteForever as DeleteForeverIcon,
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  ColumnDef,
  flexRender,
  FilterFn,
  SortingState,
  ColumnFiltersState,
} from '@tanstack/react-table';
import { databaseService, RecordData, TableInfo } from '@/services/databaseService';
import { AuthenticationError, AuthorizationError } from '@/utils/api';
import toast from 'react-hot-toast';
import clientLogger from '@/lib/clientLogger';

const DATABASE_OPTIONS = [
  { value: 'notely_v3', label: 'notely v3' },
];

const globalFilterFn: FilterFn<RecordData> = (row, _columnId, filterValue) => {
  const search = filterValue.toLowerCase();
  const rowValues = Object.values(row.original)
    .map((v) =>
      v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    )
    .join(' ')
    .toLowerCase();
  return rowValues.includes(search);
};

const DatabaseViewer = () => {
  const theme = useTheme();
  const router = useRouter();
  const [selectedDatabase, setSelectedDatabase] = useState<string>(DATABASE_OPTIONS[0]?.value ?? '');
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [data, setData] = useState<RecordData[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  // Delete dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<RecordData | null>(null);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);

  // Fetch tables on mount and when database changes
  useEffect(() => {
    fetchTables();
    // Clear selected table when database changes
    setSelectedTable('');
    setData([]);
    setColumns([]);
    setTotalCount(0);
  }, [selectedDatabase]);

  // Fetch records when table changes
  useEffect(() => {
    if (selectedTable) {
      fetchTableRecords();
    }
  }, [selectedTable, selectedDatabase]);

  const fetchTables = async () => {
    if (!selectedDatabase) {
      setTables([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const tableData = await databaseService.getTables(selectedDatabase);
      setTables(tableData);
    } catch (err) {
      if (err instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
      } else if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to access database tables.');
        setError('Access denied');
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to fetch tables';
        setError(errorMessage);
        toast.error(errorMessage);
        clientLogger.error('Failed to fetch tables', { error: err });
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchTableRecords = async () => {
    if (!selectedTable || !selectedDatabase) return;

    try {
      setLoading(true);
      setError(null);
      const result = await databaseService.getTableRecords(selectedTable, {
        database: selectedDatabase,
        page: 0,
        limit: 1000,
      });

      setData(result.records);
      setColumns(result.columns);
      setTotalCount(result.totalCount);
    } catch (err) {
      if (err instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
      } else if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to access database records.');
        setError('Access denied');
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to fetch records';
        setError(errorMessage);
        toast.error(errorMessage);
        clientLogger.error('Failed to fetch records', { error: err, table: selectedTable });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (record: RecordData) => {
    setRecordToDelete(record);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!recordToDelete || !selectedTable) return;

    try {
      setLoading(true);
      await databaseService.deleteRecord(selectedTable, String(recordToDelete.id), selectedDatabase);
      toast.success('Record deleted successfully');
      await fetchTableRecords();
      setDeleteDialogOpen(false);
      setRecordToDelete(null);
    } catch (err) {
      if (err instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
      } else if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to delete records.');
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to delete record';
        setError(errorMessage);
        toast.error(errorMessage);
        clientLogger.error('Failed to delete record', { error: err, recordId: recordToDelete.id });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAllConfirm = async () => {
    if (!selectedTable) return;

    setDeleteAllDialogOpen(false);
    try {
      setLoading(true);
      const result = await databaseService.deleteAllRecords(selectedTable, selectedDatabase);
      toast.success(`Deleted ${result.deletedCount} records`);
      await Promise.all([fetchTableRecords(), fetchTables()]);
    } catch (err) {
      if (err instanceof AuthenticationError) {
        toast.error('Session expired. Please log in again.');
        router.push('/login');
      } else if (err instanceof AuthorizationError) {
        toast.error('You do not have permission to delete all records.');
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to delete all records';
        setError(errorMessage);
        toast.error(errorMessage);
        clientLogger.error('Failed to delete all records', { error: err, table: selectedTable });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExportData = () => {
    const exportData = table.getFilteredRowModel().rows.map((row) => row.original);
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedTable}_export_${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Data exported successfully');
  };

  const handleCopyCell = (value: any) => {
    const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const tableColumns = useMemo<ColumnDef<RecordData>[]>(() => {
    if (!columns.length) return [];

    return columns.map((col) => ({
      accessorKey: col,
      header: col,
      cell: ({ getValue }) => {
        const value = getValue();

        if (value === null || value === undefined) {
          return (
            <Chip label="null" size="small" variant="outlined" sx={{ opacity: 0.5 }} />
          );
        }

        if (typeof value === 'boolean') {
          return (
            <Chip
              label={value ? 'true' : 'false'}
              size="small"
              color={value ? 'success' : 'default'}
              variant="outlined"
            />
          );
        }

        if (
          value instanceof Date ||
          (typeof value === 'string' && !isNaN(Date.parse(value)) && value.includes('-'))
        ) {
          return (
            <Tooltip title={new Date(value).toISOString()} placement="top">
              <Typography variant="body2" fontSize="0.8125rem">
                {new Date(value).toLocaleString()}
              </Typography>
            </Tooltip>
          );
        }

        if (typeof value === 'object') {
          const jsonString = JSON.stringify(value, null, 2);
          return (
            <Stack direction="row" alignItems="center" spacing={1}>
              <Tooltip title={<pre style={{ margin: 0 }}>{jsonString}</pre>}>
                <Typography
                  variant="body2"
                  fontSize="0.8125rem"
                  sx={{
                    maxWidth: 300,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {jsonString.substring(0, 50)}...
                </Typography>
              </Tooltip>
              <IconButton size="small" onClick={() => handleCopyCell(value)}>
                <CopyIcon fontSize="small" />
              </IconButton>
            </Stack>
          );
        }

        const stringValue = String(value);
        if (stringValue.length > 50) {
          return (
            <Tooltip title={stringValue} placement="top">
              <Typography variant="body2" fontSize="0.8125rem" sx={{ cursor: 'help' }}>
                {stringValue.substring(0, 50)}...
              </Typography>
            </Tooltip>
          );
        }

        return (
          <Typography variant="body2" fontSize="0.8125rem">
            {stringValue}
          </Typography>
        );
      },
    }));
  }, [columns]);

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn,
  });

  return (
    <>
      {/* Toolbar */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel>Database</InputLabel>
            <Select
              value={selectedDatabase}
              onChange={(e) => {
                setSelectedDatabase(e.target.value);
                setGlobalFilter('');
                setColumnFilters([]);
              }}
              label="Database"
              disabled={DATABASE_OPTIONS.length === 0}
            >
              {DATABASE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth: 300 }}>
            <InputLabel>Select Table</InputLabel>
            <Select
              value={selectedTable}
              onChange={(e) => {
                setSelectedTable(e.target.value);
                setGlobalFilter('');
                setColumnFilters([]);
              }}
              label="Select Table"
              disabled={tables.length === 0}
            >
              {tables.map((table) => (
                <MenuItem key={table.name} value={table.name}>
                  {table.name} ({table.count.toLocaleString()} records)
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {selectedTable && (
            <TextField
              placeholder="Search all columns..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              size="small"
              sx={{ minWidth: 250 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
            />
          )}

          <Box sx={{ flexGrow: 1 }} />

          <Tooltip title="Refresh">
            <IconButton
              onClick={() => {
                if (selectedTable) {
                  fetchTableRecords();
                } else {
                  fetchTables();
                }
              }}
              disabled={loading}
            >
              <RefreshIcon />
            </IconButton>
          </Tooltip>

          {selectedTable && (
            <Tooltip title="Export filtered data">
              <IconButton onClick={handleExportData} disabled={loading}>
                <DownloadIcon />
              </IconButton>
            </Tooltip>
          )}

          {selectedTable && (
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={<DeleteForeverIcon />}
              onClick={() => setDeleteAllDialogOpen(true)}
              disabled={loading || totalCount === 0}
            >
              Clear Table
            </Button>
          )}
        </Stack>
      </Paper>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Records Table */}
      {selectedTable && (
        <Paper>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="h6">{selectedTable}</Typography>
            <Typography variant="body2" color="text.secondary">
              Showing {table.getFilteredRowModel().rows.length} of{' '}
              {totalCount.toLocaleString()} records
              {globalFilter && ` (filtered)`}
            </Typography>
          </Box>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          style={{
                            padding: '12px',
                            textAlign: 'left',
                            borderBottom: `2px solid ${theme.palette.divider}`,
                            background: theme.palette.mode === 'dark'
                              ? theme.palette.background.default
                              : theme.palette.grey[100],
                            color: theme.palette.text.primary,
                            cursor: header.column.getCanSort() ? 'pointer' : 'default',
                            userSelect: 'none',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                          }}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                            {header.column.getIsSorted() && (
                              <span>
                                {header.column.getIsSorted() === 'asc' ? '↑' : '↓'}
                              </span>
                            )}
                          </Box>
                        </th>
                      ))}
                      <th
                        style={{
                          padding: '12px',
                          background: theme.palette.mode === 'dark'
                            ? theme.palette.background.default
                            : theme.palette.grey[100],
                          color: theme.palette.text.primary,
                          borderBottom: `2px solid ${theme.palette.divider}`,
                          fontSize: '0.875rem',
                          fontWeight: 600,
                        }}
                      >
                        Actions
                      </th>
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} style={{ borderBottom: `1px solid ${theme.palette.divider}` }}>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} style={{ padding: '12px' }}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                      <td style={{ padding: '12px' }}>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteClick(row.original)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {table.getRowModel().rows.length === 0 && (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography color="text.secondary">
                    {globalFilter ? 'No matching records found' : 'No records in this table'}
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {/* Pagination */}
          {table.getPageCount() > 1 && (
            <Box
              sx={{
                p: 2,
                borderTop: 1,
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flexWrap: 'wrap',
              }}
            >
              <Button
                size="small"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                First
              </Button>
              <Button
                size="small"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <Typography variant="body2">
                Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
              </Typography>
              <Button
                size="small"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
              <Button
                size="small"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                Last
              </Button>
              <Select
                size="small"
                value={table.getState().pagination.pageSize}
                onChange={(e) => table.setPageSize(Number(e.target.value))}
              >
                {[10, 20, 50, 100, 500].map((pageSize) => (
                  <MenuItem key={pageSize} value={pageSize}>
                    Show {pageSize}
                  </MenuItem>
                ))}
              </Select>
            </Box>
          )}
        </Paper>
      )}

      {/* Delete Record Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this record? This action cannot be undone.
          </DialogContentText>
          {recordToDelete && (
            <Box mt={2}>
              <Typography variant="body2" color="text.secondary">
                Record ID: {recordToDelete.id}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete All Records Dialog */}
      <Dialog
        open={deleteAllDialogOpen}
        onClose={() => setDeleteAllDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ color: 'error.main' }}>⚠️ Clear Table</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will delete ALL {totalCount.toLocaleString()} records from the{' '}
            <strong>{selectedTable}</strong> table.
          </DialogContentText>
          <DialogContentText sx={{ mt: 2, color: 'error.main', fontWeight: 'bold' }}>
            This action is IRREVERSIBLE!
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteAllDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteAllConfirm} color="error" variant="contained">
            Clear All Records
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default DatabaseViewer;
