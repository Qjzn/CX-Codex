import assert from 'node:assert/strict'
import {
  buildMobilePushReadinessReport,
  inspectAndroidFirebaseConfig,
  inspectFirebaseServiceAccount,
} from './verify-mobile-push-readiness.mjs'

const projectId = 'cx-codex-mobile-test'
const privateKeyFixture = [
  '-----BEGIN',
  'PRIVATE KEY-----\nfixture\n-----END',
  'PRIVATE KEY-----\n',
].join(' ')
const android = inspectAndroidFirebaseConfig({
  project_info: { project_id: projectId, project_number: '1234567890' },
  client: [{
    client_info: {
      mobilesdk_app_id: '1:1234567890:android:fixture',
      android_client_info: { package_name: 'com.cxcodex.bridge' },
    },
  }],
})
const server = inspectFirebaseServiceAccount({
  project_id: projectId,
  client_email: 'fixture@cx-codex-mobile-test.iam.gserviceaccount.com',
  private_key: privateKeyFixture,
})
const ready = buildMobilePushReadinessReport({
  android,
  server,
  live: {
    reachable: true,
    configurationState: 'configured',
    registrationCount: 1,
    subscribedRegistrationCount: 1,
  },
})

assert.equal(ready.configurationReady, true)
assert.equal(ready.deviceRegistrationReady, true)
assert.equal(ready.activeSubscriptionReady, true)
assert.equal(ready.ready, true)
assert.deepEqual(ready.missing, [])

const mismatch = buildMobilePushReadinessReport({
  android,
  server: inspectFirebaseServiceAccount({
    project_id: 'another-project',
    client_email: 'fixture@another-project.iam.gserviceaccount.com',
    private_key: privateKeyFixture,
  }),
  live: {
    reachable: true,
    configurationState: 'configured',
    registrationCount: 0,
    subscribedRegistrationCount: 0,
  },
})
assert.equal(mismatch.firebaseProjectMatch, false)
assert.equal(mismatch.ready, false)
assert.ok(mismatch.missing.includes('firebase_project_mismatch'))
assert.ok(mismatch.missing.includes('device_registration_missing'))
assert.ok(mismatch.missing.includes('active_subscription_missing'))

const missingDevice = buildMobilePushReadinessReport({
  android,
  server,
  live: {
    reachable: true,
    configurationState: 'configured',
    registrationCount: 0,
    subscribedRegistrationCount: 0,
  },
})
assert.equal(missingDevice.configurationReady, true)
assert.equal(missingDevice.deviceRegistrationReady, false)
assert.equal(missingDevice.activeSubscriptionReady, false)
assert.equal(missingDevice.ready, false)

const missingSubscription = buildMobilePushReadinessReport({
  android,
  server,
  live: {
    reachable: true,
    configurationState: 'configured',
    registrationCount: 1,
    subscribedRegistrationCount: 0,
    lastError: projectId,
  },
})
assert.equal(missingSubscription.configurationReady, true)
assert.equal(missingSubscription.deviceRegistrationReady, true)
assert.equal(missingSubscription.activeSubscriptionReady, false)
assert.equal(missingSubscription.ready, false)
assert.equal(missingSubscription.liveServer.lastErrorCode, 'provider_error')

const serialized = JSON.stringify([ready, missingSubscription])
assert.equal(serialized.includes('PRIVATE KEY'), false)
assert.equal(serialized.includes('fixture@'), false)
assert.equal(serialized.includes(projectId), false)

console.log('mobile push readiness smoke ok')
