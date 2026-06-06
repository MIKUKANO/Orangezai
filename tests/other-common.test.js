import { describe, expect, test } from "bun:test"
import { buildForceUpdateCommands, getGitErrorUrl, handleGitError } from "../plugins/other/common.js"

describe("other plugin common helpers", () => {
    test("buildForceUpdateCommands uses fetch and hard reset", () => {
        expect(buildForceUpdateCommands("origin/main")).toEqual([
            [
                "git",
                "fetch",
                "--prune"
            ],
            [
                "git",
                "reset",
                "--hard",
                "origin/main"
            ]
        ])
    })

    test("getGitErrorUrl extracts remote url from git error text", () => {
        const error = "fatal: unable to access 'https://github.com/zhiyu1998/Orangezai/': gnutls_handshake() failed"

        expect(getGitErrorUrl(error)).toBe("https://github.com/zhiyu1998/Orangezai/")
    })

    test("handleGitError returns remote connection message", async () => {
        const replies = []

        const result = await handleGitError({
            error: "fatal: unable to access 'https://github.com/zhiyu1998/Orangezai/': gnutls_handshake() failed",
            reply: async msg => {
                replies.push(msg)
            }
        })

        expect(result).toBe(false)
        expect(replies).toEqual([
            "远程仓库连接错误：https://github.com/zhiyu1998/Orangezai/"
        ])
    })

    test("handleGitError returns true when rebase retry succeeds", async () => {
        const replies = []

        const result = await handleGitError({
            error: "fatal: divergent branches",
            stdout: "",
            reply: async msg => {
                replies.push(msg)
            },
            retryRebase: async () => ({
                error: null,
                stdout: "Successfully rebased and updated refs/heads/main",
                stderr: ""
            })
        })

        expect(result).toBe(true)
        expect(replies).toEqual([])
    })
})
