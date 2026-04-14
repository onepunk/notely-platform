import { Card, CardContent, CardHeader } from '@mui/material';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const data = [
  { name: 'Mon', notes: 24 },
  { name: 'Tue', notes: 32 },
  { name: 'Wed', notes: 28 },
  { name: 'Thu', notes: 36 },
  { name: 'Fri', notes: 41 },
  { name: 'Sat', notes: 18 },
  { name: 'Sun', notes: 22 },
];

const ProductivityChart = () => (
  <Card>
    <CardHeader title="Weekly Note Throughput" subheader="Combined insights across the organization" />
    <CardContent>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorNotes" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4caf50" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#4caf50" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Area type="monotone" dataKey="notes" stroke="#4caf50" fillOpacity={1} fill="url(#colorNotes)" />
        </AreaChart>
      </ResponsiveContainer>
    </CardContent>
  </Card>
);

export default ProductivityChart;
