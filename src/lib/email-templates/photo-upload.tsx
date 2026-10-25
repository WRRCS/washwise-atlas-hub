import { Body, Button, Container, Head, Heading, Html, Preview, Text } from '@react-email/components';
import type { TemplateEntry } from './registry';

type Props = { cleanerName?: string; clientName?: string; propertyName?: string; appointmentDate?: string; photoCount?: number; appointmentUrl?: string };
function PhotoUploadEmail({ cleanerName = 'Cleaner', clientName = 'Client', propertyName = 'Location needs review', appointmentDate = 'Date needs review', photoCount = 0, appointmentUrl }: Props) {
  return <Html><Head /><Preview>{cleanerName} saved {photoCount} new photos for {propertyName}</Preview>
    <Body style={{ backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }}><Container style={{ padding: '28px', maxWidth: '600px' }}>
      <Text>Wash Rinse Repeat Cleaning · WRRCS</Text><Heading>Appointment photos uploaded</Heading>
      <Text>{cleanerName} successfully saved {photoCount} new {photoCount === 1 ? 'photo' : 'photos'}.</Text>
      <Text>Client: {clientName}<br />Property: {propertyName}<br />Appointment: {appointmentDate}</Text>
      {appointmentUrl && <Button href={appointmentUrl}>View appointment photos</Button>}
    </Container></Body></Html>;
}
export const template = { component: PhotoUploadEmail, subject: (data) => `${data.cleanerName || 'Cleaner'} uploaded ${data.photoCount || 0} appointment photos — WRRCS`, displayName: 'Cleaner photo upload', previewData: { cleanerName: 'Test Cleaner', clientName: 'Test Client', propertyName: 'Selected Test Property', appointmentDate: 'October 24, 2026', photoCount: 3 } } satisfies TemplateEntry;