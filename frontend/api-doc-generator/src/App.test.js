import { render, screen } from '@testing-library/react';
import App from './App';

test('renders API Documentation Generator title', () => {
  render(<App />);
  const titleElement = screen.getByText(/API Documentation Generator/i);
  expect(titleElement).toBeInTheDocument();
});
