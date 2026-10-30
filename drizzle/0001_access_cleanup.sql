CREATE TRIGGER IF NOT EXISTS member_access_cleanup AFTER DELETE ON member BEGIN
  DELETE FROM member_site_access WHERE memberId=OLD.id;
  DELETE FROM teamMember WHERE userId=OLD.userId AND teamId IN (SELECT id FROM team WHERE organizationId=OLD.organizationId);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS team_access_cleanup AFTER DELETE ON team BEGIN
  DELETE FROM team_site_access WHERE teamId=OLD.id;
END;
--> statement-breakpoint
UPDATE billing_checkout
SET expiresAt = strftime('%Y-%m-%dT%H:%M:%fZ', createdAt, '+1 hour')
WHERE status='creating' AND expiresAt IS NULL;
