package com.ctaiot.ctprinter.ctpl_demo;

/**
 * @Author Jaco
 * @Date 2022/12/5
 * @Desc
 */
public final class RespObj<T> {
    public Integer code;
    public String message;
    public T data;
    public Object attachment;

    public Integer getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }

    public T getData() {
        return data;
    }

    public Object getAttachment() {
        return attachment;
    }
}