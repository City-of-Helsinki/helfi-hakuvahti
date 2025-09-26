# Test Instructions for Setting Up and Testing Hakuvahti with Rekry

This guide provides step-by-step instructions for installing, configuring, and testing the Hakuvahti integration with the Rekry application. Follow these steps carefully to ensure a successful setup and test of the job subscription and email notification functionality.

## Prerequisites

- Access to a development environment with Docker and command-line tools
- Rekry website (https://helfi-rekry.docker.so)
- Ensure Elasticsearch and Mailpit are configured and accessible

## Step-by-Step Instructions

### Step 1: Install Rekry with Helbit Integration

**Goal:** Install the Rekry by following the official instructions provided in the GitHub repository.

**Action:** Clone the repository and set up the application as per the provided guidelines.

**Post-Installation:** Index Elasticsearch to ensure the search functionality is ready.

```bash
drush sapi-rt
drush sapi-c
drush sapi-i
drush cr
```

**Note:** These commands reset, clear, index, and rebuild the cache for Elasticsearch. Run them in the Rekry project directory.

### Step 2: Set Up Hakuvahti

**Goal:** Configure the Hakuvahti subscription service by following the Hakuvahti installation instructions.

**Action:** Complete all steps to install and run Hakuvahti locally.

**Note:** Ensure the Hakuvahti service is properly connected to the Rekry application.

### Step 3: Create a Hakuvahti Subscription

**Goal:** Create a new job subscription (Hakuvahti) using the Rekry website's job search page at https://helfi-rekry.docker.so/fi/avoimet-tyopaikat/etsi-avoimia-tyopaikkoja.

**Action:** Perform a simple search using a keyword (e.g., "opettaja") to create a test subscription.

**Tip:** Use broad or simple search terms to ensure test job listings can match the subscription criteria easily.

### Step 4: Access the Hakuvahti Node Server

**Goal:** Enter the Hakuvahti Node.js server environment to execute commands.

**Action:** Run the following command in the Hakuvahti project directory:

```bash
make shell
```

**Note:** This command opens a shell session within the Hakuvahti Node server container.

### Step 5: Send the Hakuvahti Signup Email

**Goal:** Populate the email queue and send the subscription confirmation email.

**Action:** In the Hakuvahti shell, run:

```bash
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
```

**Purpose:** These commands generate and send the signup confirmation email to the user.

### Step 6: Access and Read Emails in Mailpit

**Goal:** Check the signup email sent by Hakuvahti using the Mailpit interface.

**Action:** Navigate to https://mailpit.docker.so/ in your browser.

**Note:** Ensure Mailpit is running and configured to capture emails from the Hakuvahti service.

### Step 7: Confirm the Hakuvahti Subscription

**Goal:** Verify and activate the subscription using the confirmation link in the email.

**Action:** Open the signup email in Mailpit and click the confirmation link to activate the Hakuvahti subscription.

**Note:** Confirmation is required for the subscription to become active and receive job notifications.

### Step 8: Add a Matching Job Listing in Rekry

**Goal:** Create a new job listing in Rekry that matches the criteria of your Hakuvahti subscription.

**Action:** Log in to the Rekry admin interface and add a job listing at https://helfi-rekry.docker.so/fi/avoimet-tyopaikat/node/add/job_listing.

**Tip:** Ensure the job details (e.g., keywords, location) align with the subscription created in Step 3.

### Step 9: Re-Index Elasticsearch in Rekry

**Goal:** Update the Elasticsearch index to include the new job listing.

**Action:** Run the following commands in the Rekry project directory:

```bash
drush sapi-i
drush cr
```

**Verification:** Check the Rekry search page https://helfi-rekry.docker.so/fi/avoimet-tyopaikat/etsi-avoimia-tyopaikkoja to confirm the new job listing appears.

### Step 10: Send Job Notification Emails

**Goal:** Trigger Hakuvahti to send an email notification for the new job listing that matches the subscription.

**Action:** In the Hakuvahti shell (access via `make shell` if needed), run:

```bash
npm run hav:populate-email-queue
npm run hav:send-emails-in-queue
```

**Verification:** Return to https://mailpit.docker.so/ and confirm that a new email containing the job listing details has been received.

## Additional Notes

- **Environment:** Ensure all commands are executed in the correct project directories (Rekry or Hakuvahti)
- **Testing Tip:** Use unique keywords in your job listings and subscriptions to avoid confusion during testing or check the number of results for the search.

## Conclusion

By following these steps, you will have successfully installed Rekry and Hakuvahti, created a job subscription, added a matching job listing, and verified email notifications. If you encounter issues, refer to the respective GitHub repositories for additional documentation or support.
